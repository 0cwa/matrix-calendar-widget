#!/usr/bin/env python3
"""Run a pinned, headless Thunderbird Calendar-tab startup smoke on CI."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


LOCK_PATH = Path(__file__).with_name("thunderbird-calendar-smoke-artifacts.json")
ROOT_PARENT = Path("/var/tmp")
EXPECTED_ARCHIVE_HOST = "archive.mozilla.org"
EXPECTED_PACKAGE_HOST = "files.pythonhosted.org"
DOWNLOAD_TIMEOUT_SECONDS = 25
DOWNLOAD_TOTAL_SECONDS = 300
COMMAND_TIMEOUT_SECONDS = 180
SMOKE_TIMEOUT_SECONDS = 120
FAILURE_CLASSES = {
    "invalid_input",
    "unsupported_runner",
    "network_error",
    "artifact_mismatch",
    "unsafe_archive",
    "dependency_error",
    "namespace_unavailable",
    "startup_timeout",
    "marionette_error",
    "cleanup_error",
    "internal_error",
}
PHASES = {
    "preflight",
    "download",
    "hash_verification",
    "extraction",
    "dependency_install",
    "startup",
    "complete",
}


class SmokeFailure(RuntimeError):
    def __init__(self, phase: str, error_class: str):
        super().__init__(error_class)
        self.phase = phase
        self.error_class = error_class


def _source_sha() -> str:
    value = os.environ.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise SmokeFailure("preflight", "invalid_input")
    return value


def _run_identity() -> tuple[str, str]:
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    if not re.fullmatch(r"[0-9]{1,20}", run_id) or not re.fullmatch(r"[0-9]{1,4}", attempt):
        raise SmokeFailure("preflight", "invalid_input")
    return run_id, attempt


def _root_path() -> Path:
    run_id, attempt = _run_identity()
    if ROOT_PARENT.is_symlink() or not ROOT_PARENT.is_dir():
        raise SmokeFailure("preflight", "unsupported_runner")
    return ROOT_PARENT / f"tb-calendar-smoke-{run_id}-{attempt}"


def _summary_path() -> Path:
    runner_temp = os.environ.get("RUNNER_TEMP", "")
    if not runner_temp:
        raise SmokeFailure("preflight", "invalid_input")
    directory = Path(runner_temp)
    if not directory.is_absolute() or directory.is_symlink() or not directory.is_dir():
        raise SmokeFailure("preflight", "invalid_input")
    return directory / "thunderbird-calendar-smoke-summary.json"


def _initial_summary(source_sha: str) -> dict[str, Any]:
    return {
        "schema": "thunderbird-calendar-startup-smoke@1",
        "qualification_scope": "startup_only_not_caldav",
        "source_sha": source_sha,
        "status": "running",
        "phase": "preflight",
        "error_class": None,
        "archive_sha256_verified": False,
        "archive_sha512_verified": False,
        "python_artifacts_verified": False,
        "rootless_namespace_verified": False,
        "marionette_handshake": False,
        "main_window": False,
        "calendar_tab": False,
        "app_version": None,
    }


def _write_summary(payload: dict[str, Any]) -> None:
    path = _summary_path()
    safe = _initial_summary(payload.get("source_sha", ""))
    for name in safe:
        if name in payload:
            safe[name] = payload[name]
    if (
        not isinstance(safe["source_sha"], str)
        or not re.fullmatch(r"[0-9a-f]{40}", safe["source_sha"])
        or safe["schema"] != "thunderbird-calendar-startup-smoke@1"
        or safe["qualification_scope"] != "startup_only_not_caldav"
        or not isinstance(safe["status"], str)
        or safe["status"] not in {"running", "passed", "failed"}
        or not isinstance(safe["phase"], str)
        or safe["phase"] not in PHASES
        or safe["error_class"] not in (None, *FAILURE_CLASSES)
        or any(
            type(safe[name]) is not bool
            for name in (
                "archive_sha256_verified",
                "archive_sha512_verified",
                "python_artifacts_verified",
                "rootless_namespace_verified",
                "marionette_handshake",
                "main_window",
                "calendar_tab",
            )
        )
        or (
            safe["app_version"] is not None
            and (
                not isinstance(safe["app_version"], str)
                or not re.fullmatch(r"[0-9]+\.[0-9]+(?:\.[0-9]+)?", safe["app_version"])
            )
        )
    ):
        safe = _initial_summary("0" * 40)
        safe.update({"status": "failed", "phase": "complete", "error_class": "internal_error"})
    temporary = path.with_suffix(".json.tmp")
    encoded = json.dumps(safe, sort_keys=True, separators=(",", ":")) + "\n"
    fd = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        output.write(encoded)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    os.chmod(path, 0o600)


def _load_lock() -> dict[str, Any]:
    try:
        data = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise SmokeFailure("preflight", "invalid_input") from None
    if data.get("schema") != "thunderbird-calendar-smoke-artifacts@1":
        raise SmokeFailure("preflight", "invalid_input")
    if data.get("python") != {
        "implementation": "CPython",
        "version": "3.13",
        "platform": "Linux x86_64",
    }:
        raise SmokeFailure("preflight", "unsupported_runner")
    release = data.get("thunderbird", {})
    if (
        release.get("version") != "158.0.1"
        or release.get("filename") != "thunderbird-158.0.1.tar.xz"
        or release.get("size") != 87_464_720
        or not re.fullmatch(r"[0-9a-f]{64}", release.get("sha256", ""))
        or not re.fullmatch(r"[0-9a-f]{128}", release.get("sha512", ""))
        or not _permitted_url(release.get("url", ""), EXPECTED_ARCHIVE_HOST, release.get("filename", ""))
    ):
        raise SmokeFailure("preflight", "invalid_input")
    packages = data.get("packages")
    if not isinstance(packages, list) or len(packages) != 20:
        raise SmokeFailure("preflight", "invalid_input")
    names: set[str] = set()
    for item in packages:
        name = item.get("name", "")
        filename = item.get("filename", "")
        if (
            not re.fullmatch(r"[A-Za-z0-9_.-]+", name)
            or name.lower() in names
            or not re.fullmatch(r"[A-Za-z0-9_.+-]+", filename)
            or not isinstance(item.get("size"), int)
            or item["size"] <= 0
            or not re.fullmatch(r"[0-9a-f]{64}", item.get("sha256", ""))
            or not _permitted_url(item.get("url", ""), EXPECTED_PACKAGE_HOST, filename)
        ):
            raise SmokeFailure("preflight", "invalid_input")
        names.add(name.lower())
    return data


def _permitted_url(url: str, host: str, filename: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
        port_ok = parsed.port in (None, 443)
    except (TypeError, ValueError):
        return False
    return (
        parsed.scheme == "https"
        and parsed.hostname == host
        and port_ok
        and parsed.username is None
        and parsed.password is None
        and not parsed.query
        and not parsed.fragment
        and parsed.path.rsplit("/", 1)[-1] == filename
    )


def _validate_runner() -> None:
    if (
        sys.implementation.name != "cpython"
        or sys.version_info[:2] != (3, 13)
        or platform.system() != "Linux"
        or platform.machine() != "x86_64"
        or os.geteuid() == 0
    ):
        raise SmokeFailure("preflight", "unsupported_runner")
    home = os.environ.get("HOME", "")
    if not home:
        raise SmokeFailure("preflight", "unsupported_runner")
    home_path = Path(home)
    if not home_path.is_absolute() or home_path.is_symlink() or not home_path.is_dir():
        raise SmokeFailure("preflight", "unsupported_runner")
    run_user = Path("/run/user")
    if run_user.is_symlink() or not run_user.is_dir():
        raise SmokeFailure("preflight", "unsupported_runner")
    bwrap = shutil.which("bwrap")
    if not bwrap:
        raise SmokeFailure("preflight", "namespace_unavailable")


def _namespace_environment(root: Path | None, *, installing: bool = False) -> dict[str, str]:
    home = os.environ.get("HOME", "")
    env = {
        "HOME": home,
        "PATH": "/usr/sbin:/usr/bin:/sbin:/bin",
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "PYTHONNOUSERSITE": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    for name, value in os.environ.items():
        if name == "TZ" or name.startswith(("LC_", "LD_")):
            env[name] = value
    if root is not None:
        env.update(
            {
                "PATH": f"{root / 'venv' / 'bin'}:/usr/sbin:/usr/bin:/sbin:/bin",
                "TMPDIR": "/tmp",
                "XDG_CONFIG_HOME": str(root / "config"),
                "XDG_CACHE_HOME": str(root / "cache"),
                "XDG_DATA_HOME": str(root / "data"),
                "XDG_STATE_HOME": str(root / "state"),
                "XDG_RUNTIME_DIR": str(root / "runtime"),
                "MOZ_HEADLESS": "1",
            }
        )
    if installing:
        env.update(
            {
                "PIP_CONFIG_FILE": "/dev/null",
                "PIP_DISABLE_PIP_VERSION_CHECK": "1",
                "PIP_NO_INDEX": "1",
            }
        )
    return env


def _bwrap_command(
    command: list[str],
    *,
    root: Path | None = None,
    installing: bool = False,
) -> list[str]:
    _validate_runner()
    bwrap = shutil.which("bwrap")
    assert bwrap is not None
    home = os.environ["HOME"]
    args = [
        bwrap,
        "--die-with-parent",
        "--unshare-user",
        "--unshare-net",
        "--unshare-pid",
        "--ro-bind",
        "/",
        "/",
        "--tmpfs",
        home,
        "--tmpfs",
        "/run/user",
    ]
    if root is not None:
        if root.parent != ROOT_PARENT or root.is_symlink() or not root.is_dir():
            raise SmokeFailure("preflight", "invalid_input")
        readonly = ["app"]
        if not installing:
            readonly.append("venv")
        args.extend(["--tmpfs", str(root / "downloads")])
        if not installing:
            args.extend(["--tmpfs", str(root / "python-artifacts")])
        else:
            readonly.extend(["python-artifacts"])
            args.extend(["--bind", str(root / "venv"), str(root / "venv")])
        for name in readonly:
            path = root / name
            if not path.is_dir() or path.is_symlink():
                raise SmokeFailure("preflight", "invalid_input")
            args.extend(["--ro-bind", str(path), str(path)])
        if installing:
            writable = ("tmp",)
        else:
            writable = ("workspace", "config", "cache", "data", "state", "runtime", "tmp")
        for name in writable:
            path = root / name
            if not path.is_dir() or path.is_symlink():
                raise SmokeFailure("preflight", "invalid_input")
            args.extend(["--bind", str(path), str(path)])
        args.extend(["--bind", str(root / "tmp"), "/tmp"])
    args.extend(["--proc", "/proc", "--dev", "/dev", "--clearenv"])
    env = _namespace_environment(root, installing=installing)
    for name, value in env.items():
        args.extend(["--setenv", name, value])
    working_directory = str(root / "workspace") if root is not None else "/tmp"
    args.extend(["--chdir", working_directory, "--", *command])
    return args


def _probe_namespace() -> None:
    _validate_runner()
    host_namespaces = {
        "user": os.readlink("/proc/self/ns/user"),
        "pid": os.readlink("/proc/self/ns/pid"),
        "mount": os.readlink("/proc/self/ns/mnt"),
    }
    probe = r'''
import json, os, socket, subprocess, sys
host_user, host_pid, host_mount = sys.argv[1:4]
home = os.environ["HOME"]
def fs_type(path):
    return subprocess.check_output(["stat", "-f", "-c", "%T", path], text=True).strip()
routes = subprocess.check_output(["ip", "route", "show"], text=True).splitlines()
links = [name for _, name in socket.if_nameindex()]
status = open("/proc/self/status", encoding="ascii").read().splitlines()
cap_eff = int(next(line.split()[1] for line in status if line.startswith("CapEff:")), 16)
pids = sorted(int(name) for name in os.listdir("/proc") if name.isdigit())
s = socket.socket()
s.bind(("127.0.0.1", 0))
s.listen(1)
c = socket.create_connection(s.getsockname(), timeout=2)
a, _ = s.accept()
a.close(); c.close(); s.close()
print(json.dumps({
  "uid": os.getuid(), "euid": os.geteuid(), "gid": os.getgid(), "egid": os.getegid(),
  "user_ns": os.readlink("/proc/self/ns/user"), "pid_ns": os.readlink("/proc/self/ns/pid"),
  "mount_ns": os.readlink("/proc/self/ns/mnt"), "host_namespaces": [host_user, host_pid, host_mount],
  "cap_eff": cap_eff, "pids": pids, "self_pid": os.getpid(),
  "home": home, "home_fs": fs_type(home), "home_entries": sorted(os.listdir(home)),
  "run_user_fs": fs_type("/run/user"), "run_user_entries": sorted(os.listdir("/run/user")),
  "interfaces": links, "routes": routes, "loopback": True
}))
'''
    args = _bwrap_command(
        [sys.executable, "-B", "-c", probe, host_namespaces["user"], host_namespaces["pid"], host_namespaces["mount"]]
    )
    try:
        result = subprocess.run(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
            timeout=20,
            env=_namespace_environment(None),
        )
        observation = json.loads(result.stdout) if result.returncode == 0 else {}
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        raise SmokeFailure("preflight", "namespace_unavailable") from None
    uid = os.getuid()
    gid = os.getgid()
    pids = observation.get("pids", [])
    valid = (
        observation.get("uid") == uid
        and observation.get("euid") == os.geteuid()
        and observation.get("gid") == gid
        and observation.get("egid") == os.getegid()
        and observation.get("user_ns") != host_namespaces["user"]
        and observation.get("pid_ns") != host_namespaces["pid"]
        and observation.get("mount_ns") != host_namespaces["mount"]
        and observation.get("cap_eff") == 0
        and observation.get("self_pid") in pids
        and len(pids) <= 2
        and not ({os.getpid(), os.getppid()} & set(pids))
        and observation.get("home") == os.environ["HOME"]
        and observation.get("home_fs") == "tmpfs"
        and observation.get("home_entries") == []
        and observation.get("run_user_fs") == "tmpfs"
        and observation.get("run_user_entries") == []
        and observation.get("interfaces") == ["lo"]
        and observation.get("routes") == []
        and observation.get("loopback") is True
    )
    if not valid:
        raise SmokeFailure("preflight", "namespace_unavailable")


class _PinnedRedirectHandler(urllib.request.HTTPRedirectHandler):
    def __init__(self, host: str, filename: str):
        super().__init__()
        self.host = host
        self.filename = filename

    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
        if not _permitted_url(newurl, self.host, self.filename):
            raise SmokeFailure("download", "network_error")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


@contextmanager
def _total_wall_deadline(seconds: int, phase: str) -> Iterator[None]:
    if signal.getitimer(signal.ITIMER_REAL)[0] > 0:
        raise SmokeFailure(phase, "network_error")
    previous = signal.getsignal(signal.SIGALRM)

    def expired(_signum: int, _frame: Any) -> None:
        raise SmokeFailure(phase, "network_error")

    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def _download(record: dict[str, Any], destination: Path, host: str, *, both_hashes: bool = False) -> None:
    if not _permitted_url(record.get("url", ""), host, record.get("filename", "")):
        raise SmokeFailure("download", "invalid_input")
    request = urllib.request.Request(
        record["url"],
        headers={"User-Agent": "matrix-calendar-thunderbird-smoke/1", "Accept-Encoding": "identity"},
    )
    opener = urllib.request.build_opener(_PinnedRedirectHandler(host, record["filename"]))
    sha256 = hashlib.sha256()
    sha512 = hashlib.sha512() if both_hashes else None
    written = 0
    try:
        with opener.open(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
            if not _permitted_url(response.geturl(), host, record["filename"]):
                raise SmokeFailure("download", "network_error")
            length = response.headers.get("Content-Length")
            if length and int(length) != record["size"]:
                raise SmokeFailure("hash_verification", "artifact_mismatch")
            with destination.open("xb") as output:
                os.chmod(destination, 0o600)
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    written += len(block)
                    if written > record["size"]:
                        raise SmokeFailure("hash_verification", "artifact_mismatch")
                    output.write(block)
                    sha256.update(block)
                    if sha512 is not None:
                        sha512.update(block)
    except SmokeFailure:
        raise
    except (OSError, urllib.error.URLError, ValueError):
        raise SmokeFailure("download", "network_error") from None
    expected256 = record["sha256"]
    if written != record["size"] or sha256.hexdigest() != expected256:
        raise SmokeFailure("hash_verification", "artifact_mismatch")
    if sha512 is not None and sha512.hexdigest() != record["sha512"]:
        raise SmokeFailure("hash_verification", "artifact_mismatch")


def _safe_extract(archive_path: Path, destination: Path) -> Path:
    try:
        destination.mkdir(mode=0o700)
        with tarfile.open(archive_path, mode="r:xz") as archive:
            members = archive.getmembers()
            roots = {member.name.split("/", 1)[0] for member in members if member.name}
            if roots != {"thunderbird"}:
                raise SmokeFailure("extraction", "unsafe_archive")
            archive.extractall(path=destination, members=members, filter="data")
    except SmokeFailure:
        raise
    except (OSError, tarfile.TarError, ValueError):
        raise SmokeFailure("extraction", "unsafe_archive") from None
    binary = destination / "thunderbird" / "thunderbird"
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise SmokeFailure("extraction", "unsafe_archive")
    return binary


def _private_directories(root: Path) -> None:
    root.mkdir(mode=0o700)
    os.chmod(root, 0o700)
    for name in (
        "downloads",
        "python-artifacts",
        "venv",
        "workspace",
        "config",
        "cache",
        "data",
        "state",
        "runtime",
        "tmp",
        "logs",
    ):
        (root / name).mkdir(mode=0o700)


def _owned_marker(root: Path, source_sha: str) -> Path:
    return root / ".thunderbird-calendar-smoke-owner.json"


def _verify_owner(root: Path, source_sha: str) -> None:
    marker = _owned_marker(root, source_sha)
    if root.parent != ROOT_PARENT or root.is_symlink() or not root.is_dir() or marker.is_symlink():
        raise SmokeFailure("preflight", "invalid_input")
    try:
        owner = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise SmokeFailure("preflight", "invalid_input") from None
    if owner != {"schema": "thunderbird-calendar-smoke-owner@1", "source_sha": source_sha}:
        raise SmokeFailure("preflight", "invalid_input")


def _run_bounded(
    command: list[str],
    *,
    log_path: Path,
    timeout: int,
    env: dict[str, str],
    timeout_phase: str = "dependency_install",
    timeout_class: str = "dependency_error",
    failure_phase: str = "dependency_install",
    failure_class: str = "dependency_error",
) -> int:
    try:
        with log_path.open("ab") as log:
            process = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                env=env,
            )
            try:
                return process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=5)
                raise SmokeFailure(timeout_phase, timeout_class)
    except SmokeFailure:
        raise
    except (OSError, subprocess.SubprocessError):
        raise SmokeFailure(failure_phase, failure_class) from None


def _prepare(payload: dict[str, Any], source_sha: str, root: Path, data: dict[str, Any]) -> None:
    if root.exists() or root.is_symlink():
        raise SmokeFailure("preflight", "invalid_input")
    _private_directories(root)
    owner = _owned_marker(root, source_sha)
    owner.write_text(
        json.dumps({"schema": "thunderbird-calendar-smoke-owner@1", "source_sha": source_sha}) + "\n",
        encoding="utf-8",
    )
    os.chmod(owner, 0o600)
    release = data["thunderbird"]
    packages = data["packages"]
    try:
        payload["phase"] = "download"
        with _total_wall_deadline(DOWNLOAD_TOTAL_SECONDS, "download"):
            _download(release, root / "downloads" / release["filename"], EXPECTED_ARCHIVE_HOST, both_hashes=True)
            for package in packages:
                _download(package, root / "python-artifacts" / package["filename"], EXPECTED_PACKAGE_HOST)
        payload.update(
            {
                "phase": "hash_verification",
                "archive_sha256_verified": True,
                "archive_sha512_verified": True,
                "python_artifacts_verified": True,
            }
        )
        payload["phase"] = "extraction"
        binary = _safe_extract(root / "downloads" / release["filename"], root / "app")
        os.chmod(binary, 0o700)
        payload["phase"] = "dependency_install"
        _install_dependencies(root, packages)
    except SmokeFailure:
        raise
    except (OSError, tarfile.TarError):
        raise SmokeFailure(payload["phase"], "internal_error") from None


def _install_dependencies(root: Path, packages: list[dict[str, Any]]) -> None:
    _probe_namespace()
    env = _namespace_environment(root, installing=True)
    python = sys.executable
    log_path = root / "logs" / "dependency-install.log"
    create_venv = _bwrap_command([python, "-B", "-m", "venv", str(root / "venv")], root=root, installing=True)
    if _run_bounded(create_venv, log_path=log_path, timeout=60, env=env) != 0:
        raise SmokeFailure("dependency_install", "dependency_error")
    pip_python = root / "venv" / "bin" / "python"
    common = [
        str(pip_python),
        "-B",
        "-m",
        "pip",
        "install",
        "--isolated",
        "--no-index",
        "--no-deps",
        "--no-build-isolation",
        "--no-cache-dir",
    ]
    bootstrap_names = {"setuptools", "wheel", "packaging"}
    bootstrap = [root / "python-artifacts" / item["filename"] for item in packages if item["name"] in bootstrap_names]
    runtime = [root / "python-artifacts" / item["filename"] for item in packages if item["name"] not in bootstrap_names]
    for paths in (bootstrap, runtime):
        command = _bwrap_command(common + [str(path) for path in paths], root=root, installing=True)
        if _run_bounded(command, log_path=log_path, timeout=COMMAND_TIMEOUT_SECONDS, env=env) != 0:
            raise SmokeFailure("dependency_install", "dependency_error")
    check = _bwrap_command([str(pip_python), "-B", "-m", "pip", "check"], root=root, installing=True)
    if _run_bounded(check, log_path=log_path, timeout=30, env=env) != 0:
        raise SmokeFailure("dependency_install", "dependency_error")
    inventory_code = (
        "import importlib.metadata as m,json; "
        "print(json.dumps(sorted((d.metadata['Name'].lower().replace('_','-'),d.version) "
        "for d in m.distributions() if d.metadata.get('Name'))))"
    )
    inventory = _bwrap_command([str(pip_python), "-B", "-c", inventory_code], root=root, installing=True)
    try:
        output = subprocess.run(
            inventory,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
            timeout=30,
            env=env,
        )
        installed = set(map(tuple, json.loads(output.stdout))) if output.returncode == 0 else set()
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError, TypeError):
        raise SmokeFailure("dependency_install", "dependency_error") from None
    expected = {(item["name"].lower().replace("_", "-"), item["version"]) for item in packages}
    extras = {item for item in installed if item[0] != "pip"} - expected
    missing = expected - installed
    if extras or missing:
        raise SmokeFailure("dependency_install", "dependency_error")
    driver_check = _bwrap_command(
        [
            str(pip_python),
            "-B",
            "-c",
            "from marionette_driver.geckoinstance import apps; assert 'thunderbird' in apps",
        ],
        root=root,
        installing=True,
    )
    if _run_bounded(driver_check, log_path=log_path, timeout=30, env=env) != 0:
        raise SmokeFailure("dependency_install", "dependency_error")


def _worker_result_path(root: Path) -> Path:
    return root / "workspace" / ".smoke-result.json"


def _smoke_worker(root: Path) -> int:
    result: dict[str, Any] = {
        "marionette_handshake": False,
        "main_window": False,
        "calendar_tab": False,
        "app_version": None,
        "error_class": None,
    }
    path = _worker_result_path(root)
    profile_path: Path | None = None
    marionette = None
    try:
        from marionette_driver.marionette import Marionette

        prefs = {
            "app.update.enabled": False,
            "app.update.auto": False,
            "app.update.autoInstallEnabled": False,
            "toolkit.telemetry.enabled": False,
            "datareporting.healthreport.uploadEnabled": False,
            "datareporting.usage.uploadEnabled": False,
            "datareporting.policy.dataSubmissionEnabled": False,
            "mail.shell.checkDefaultClient": False,
            "startup.homepage_welcome_url": "about:blank",
            "startup.homepage_welcome_url.additional": "",
        }
        marionette = Marionette(
            bin=str(root / "app" / "thunderbird" / "thunderbird"),
            app="thunderbird",
            workspace=str(root / "workspace"),
            app_args=["--calendar", "--headless"],
            prefs=prefs,
            headless=False,
            startup_timeout=85,
        )
        profile_path = Path(marionette.profile_path).resolve()
        profile_path.relative_to((root / "workspace").resolve())
        capabilities = marionette.start_session()
        result["marionette_handshake"] = True
        version = capabilities.get("browserVersion")
        if isinstance(version, str) and re.fullmatch(r"[0-9]+\.[0-9]+(?:\.[0-9]+)?", version):
            result["app_version"] = version
        marionette.set_context(marionette.CONTEXT_CHROME)
        result["main_window"] = marionette.get_window_type() == "mail:3pane"
        modes = marionette.execute_script(
            "const tabs = document.getElementById('tabmail'); "
            "return tabs.tabInfo.map(info => info.mode.name);"
        )
        result["calendar_tab"] = isinstance(modes, list) and "calendar" in modes
        if result["app_version"] != "158.0.1" or not result["main_window"] or not result["calendar_tab"]:
            result["error_class"] = "marionette_error"
            return 1
        return 0
    except Exception:
        result["error_class"] = "marionette_error"
        return 1
    finally:
        try:
            if marionette is not None:
                if marionette.session is not None:
                    marionette.quit(in_app=True)
                marionette.cleanup()
            if profile_path is not None:
                profile_path.relative_to((root / "workspace").resolve())
                if profile_path.exists():
                    shutil.rmtree(profile_path)
        except Exception:
            result["error_class"] = "cleanup_error"
        path.write_text(json.dumps(result, sort_keys=True) + "\n", encoding="utf-8")
        os.chmod(path, 0o600)


def _read_worker_result(root: Path) -> dict[str, Any]:
    try:
        value = json.loads(_worker_result_path(root).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise SmokeFailure("startup", "marionette_error") from None
    expected_keys = {"marionette_handshake", "main_window", "calendar_tab", "app_version", "error_class"}
    if set(value) != expected_keys or any(type(value[key]) is not bool for key in expected_keys - {"app_version", "error_class"}):
        raise SmokeFailure("startup", "marionette_error")
    if value["error_class"] not in (None, "marionette_error", "cleanup_error"):
        raise SmokeFailure("startup", "marionette_error")
    version = value["app_version"]
    if version is not None and not re.fullmatch(r"[0-9]+\.[0-9]+(?:\.[0-9]+)?", version):
        raise SmokeFailure("startup", "marionette_error")
    return value


def _smoke(payload: dict[str, Any], source_sha: str, root: Path) -> None:
    _verify_owner(root, source_sha)
    try:
        prepared = json.loads(_summary_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise SmokeFailure("preflight", "invalid_input") from None
    if (
        prepared.get("schema") != payload["schema"]
        or prepared.get("source_sha") != source_sha
        or prepared.get("archive_sha256_verified") is not True
        or prepared.get("archive_sha512_verified") is not True
        or prepared.get("python_artifacts_verified") is not True
    ):
        raise SmokeFailure("preflight", "invalid_input")
    for name in (
        "archive_sha256_verified",
        "archive_sha512_verified",
        "python_artifacts_verified",
    ):
        payload[name] = prepared[name]
    _probe_namespace()
    payload["rootless_namespace_verified"] = True
    payload["phase"] = "startup"
    worker = [str(root / "venv" / "bin" / "python"), "-B", str(Path(__file__).resolve()), "--worker", str(root)]
    command = _bwrap_command(worker, root=root)
    log_path = root / "logs" / "thunderbird-startup.log"
    env = _namespace_environment(root)
    try:
        code = _run_bounded(
            command,
            log_path=log_path,
            timeout=SMOKE_TIMEOUT_SECONDS,
            env=env,
            timeout_phase="startup",
            timeout_class="startup_timeout",
            failure_phase="startup",
            failure_class="marionette_error",
        )
        result = _read_worker_result(root)
    except SmokeFailure:
        raise
    except (OSError, ValueError):
        raise SmokeFailure("startup", "marionette_error") from None
    payload.update({key: result[key] for key in ("marionette_handshake", "main_window", "calendar_tab", "app_version")})
    if result["error_class"]:
        raise SmokeFailure("startup", result["error_class"])
    if code != 0 or not all((result["marionette_handshake"], result["main_window"], result["calendar_tab"])):
        raise SmokeFailure("startup", "marionette_error")


def _cleanup_root(root: Path, source_sha: str) -> None:
    _verify_owner(root, source_sha)
    if root.parent != ROOT_PARENT or not re.fullmatch(r"tb-calendar-smoke-[0-9]{1,20}-[0-9]{1,4}", root.name):
        raise SmokeFailure("complete", "cleanup_error")
    shutil.rmtree(root)


def _finalize(payload: dict[str, Any]) -> None:
    path = _summary_path()
    try:
        existing = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        existing = None
    if isinstance(existing, dict) and existing.get("schema") == payload["schema"]:
        payload.update(existing)
    if payload.get("status") == "running":
        outcomes = {
            "preflight": os.environ.get("TB_PREFLIGHT_OUTCOME", ""),
            "prepare": os.environ.get("TB_PREPARE_OUTCOME", ""),
            "smoke": os.environ.get("TB_SMOKE_OUTCOME", ""),
        }
        failed = next((name for name, outcome in outcomes.items() if outcome == "failure"), None)
        payload["status"] = "failed"
        payload["error_class"] = {
            "preflight": "namespace_unavailable",
            "prepare": "dependency_error",
            "smoke": "marionette_error",
        }.get(failed, "internal_error")
        if failed == "preflight":
            payload["phase"] = "preflight"
        elif failed == "prepare":
            payload["phase"] = "dependency_install"
        elif failed == "smoke":
            payload["phase"] = "startup"
        else:
            payload["phase"] = "complete"
    if payload.get("status") not in {"passed", "failed"}:
        payload["status"] = "failed"
        payload["phase"] = "complete"
        payload["error_class"] = "internal_error"
    _write_summary(payload)


def _main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", nargs="?", choices=("preflight", "prepare", "smoke", "finalize"))
    parser.add_argument("--worker", metavar="TASK_ROOT")
    args = parser.parse_args()
    if args.worker:
        root = Path(args.worker)
        if root.parent != ROOT_PARENT:
            return 2
        return _smoke_worker(root)
    payload: dict[str, Any] = _initial_summary(os.environ.get("GITHUB_SHA", ""))
    root: Path | None = None
    try:
        source_sha = _source_sha()
        payload["source_sha"] = source_sha
        if args.mode is None:
            raise SmokeFailure("preflight", "invalid_input")
        if args.mode == "finalize":
            _finalize(payload)
            return 0
        data = _load_lock()
        _validate_runner()
        if args.mode == "preflight":
            payload["phase"] = "preflight"
            _probe_namespace()
            payload["rootless_namespace_verified"] = True
        elif args.mode == "prepare":
            root = _root_path()
            payload["phase"] = "download"
            _prepare(payload, source_sha, root, data)
        else:
            root = _root_path()
            try:
                _smoke(payload, source_sha, root)
            finally:
                _cleanup_root(root, source_sha)
            payload["phase"] = "complete"
            payload["status"] = "passed"
        _write_summary(payload)
        return 0
    except SmokeFailure as failure:
        payload["status"] = "failed"
        payload["phase"] = failure.phase if failure.phase in PHASES else "preflight"
        payload["error_class"] = failure.error_class if failure.error_class in FAILURE_CLASSES else "internal_error"
        if args.mode == "prepare" and root is not None and root.exists():
            try:
                shutil.rmtree(root)
            except OSError:
                payload["error_class"] = "cleanup_error"
        if args.mode == "smoke" and root is not None and root.exists() and payload["error_class"] != "cleanup_error":
            try:
                _cleanup_root(root, payload["source_sha"])
            except SmokeFailure:
                payload["error_class"] = "cleanup_error"
        try:
            _write_summary(payload)
        except SmokeFailure:
            pass
        return 1
    except Exception:
        payload["status"] = "failed"
        payload["error_class"] = "internal_error"
        try:
            _write_summary(payload)
        except SmokeFailure:
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(_main())
