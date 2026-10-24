#!/usr/bin/env python3
"""Run a pinned, headless Thunderbird Calendar-tab startup smoke on CI."""

from __future__ import annotations

import argparse
import http.client
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import socket
import ssl
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


LOCK_PATH = Path(__file__).with_name("thunderbird-calendar-smoke-artifacts.json")
ROOT_PARENT = Path("/var/tmp")
WORKER_FILENAME = "thunderbird-calendar-smoke.py"
LOCK_FILENAME = "thunderbird-calendar-smoke-artifacts.json"
CONTAINER_TASK_ROOT = Path("/task")
CONTAINER_RUNTIME_DIR = Path("/tmp/runtime")
EXPECTED_ARCHIVE_HOST = "archive.mozilla.org"
EXPECTED_PACKAGE_HOST = "files.pythonhosted.org"
DOWNLOAD_TIMEOUT_SECONDS = 25
DOWNLOAD_TOTAL_SECONDS = 300
COMMAND_TIMEOUT_SECONDS = 180
SMOKE_TIMEOUT_SECONDS = 120
FAILURE_CLASSES = {
    "invalid_input",
    "unsupported_runner",
    "container_backend_unavailable",
    "container_isolation_unavailable",
    "network_error",
    "artifact_mismatch",
    "unsafe_archive",
    "dependency_error",
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
NETWORK_ERROR_CLASSES = {
    "connection",
    "dns",
    "http_4xx",
    "http_5xx",
    "http_status",
    "incomplete_transfer",
    "invalid_response",
    "io_error",
    "redirect",
    "timeout",
    "tls",
    "total_deadline",
    "url_error",
    "unknown",
}
STARTUP_STAGES = {
    "worker_setup",
    "binary_version_probe",
    "marionette_import",
    "marionette_constructor",
    "profile_validation",
    "port_probe",
    "session_creation",
    "main_window_check",
    "calendar_tab_check",
    "worker_cleanup",
    "worker_result_read",
    "complete",
    "container_execution",
}
STARTUP_EXCEPTION_CLASSES = {
    "AssertionError",
    "ConnectionError",
    "FileNotFoundError",
    "ImportError",
    "ModuleNotFoundError",
    "OSError",
    "PermissionError",
    "RuntimeError",
    "SubprocessError",
    "TimeoutError",
    "TimeoutExpired",
    "TypeError",
    "ValueError",
    "other",
}
BINARY_VERSION_PROBE_RESULTS = {
    "passed",
    "nonzero_exit",
    "timeout",
    "spawn_error",
    "unparseable",
    "version_mismatch",
}
CHILD_STATES = {"unknown", "running", "exited"}
BOUNDED_VERSION_RE = re.compile(
    r"(?<![0-9])([0-9]{1,3}\.[0-9]{1,3}(?:\.[0-9]{1,3})?)(?![0-9])"
)
MAX_STARTUP_PROBE_SECONDS = 10
MAX_VERSION_OUTPUT_CHARS = 512
MAX_STARTUP_DIAGNOSTIC_BYTES = 2048
WORKER_STARTUP_DIAGNOSTIC = ".startup-version-probe.stderr.txt"
HOST_STARTUP_DIAGNOSTIC = "thunderbird-startup-probe-diagnostic.txt"
ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
STARTUP_URL_RE = re.compile(r"(?i)\b(?:https?|ftp|file)://[^\s<>\"']+")
ABSOLUTE_PATH_RE = re.compile(r"(?<![A-Za-z0-9:])/(?:[^\s<>\"']+)")
PYTHON_ARTIFACT_NAMES = frozenset(
    {
        "setuptools",
        "packaging",
        "wheel",
        "six",
        "distro",
        "wcwidth",
        "jinxed",
        "psutil",
        "mozfile",
        "mozterm",
        "mozsystemmonitor",
        "mozinfo",
        "mozprofile",
        "mozprocess",
        "blessed",
        "mozlog",
        "mozdevice",
        "mozrunner",
        "mozversion",
        "marionette-driver",
    }
)
FAILED_ARTIFACT_IDS = frozenset(
    {"mozilla_archive"}
    | {f"python_{name.replace('-', '_')}" for name in PYTHON_ARTIFACT_NAMES}
)


class SmokeFailure(RuntimeError):
    def __init__(
        self,
        phase: str,
        error_class: str,
        *,
        failed_artifact: str | None = None,
        network_error_class: str | None = None,
        http_status: int | None = None,
    ):
        super().__init__(error_class)
        self.phase = phase
        self.error_class = error_class
        self.failed_artifact = failed_artifact
        self.network_error_class = network_error_class
        self.http_status = http_status


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
        "schema": "thunderbird-calendar-startup-smoke@5",
        "qualification_scope": "startup_only_not_caldav",
        "source_sha": source_sha,
        "status": "running",
        "phase": "preflight",
        "error_class": None,
        "failed_artifact": None,
        "network_error_class": None,
        "http_status": None,
        "archive_sha256_verified": False,
        "archive_sha512_verified": False,
        "python_artifacts_verified": False,
        "docker_backend_verified": False,
        "docker_isolation_verified": False,
        "marionette_handshake": False,
        "main_window": False,
        "calendar_tab": False,
        "app_version": None,
        "startup_stage": None,
        "startup_exception_class": None,
        "binary_version_probe": None,
        "binary_version": None,
        "binary_version_exit_code": None,
        "marionette_port_ready": False,
        "marionette_session_created": False,
        "child_state": "unknown",
        "child_exit_code": None,
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
        or safe["schema"] != "thunderbird-calendar-startup-smoke@5"
        or safe["qualification_scope"] != "startup_only_not_caldav"
        or not isinstance(safe["status"], str)
        or safe["status"] not in {"running", "passed", "failed"}
        or not isinstance(safe["phase"], str)
        or safe["phase"] not in PHASES
        or safe["error_class"] not in (None, *FAILURE_CLASSES)
        or (
            safe["failed_artifact"] is not None
            and (
                not isinstance(safe["failed_artifact"], str)
                or safe["failed_artifact"] not in FAILED_ARTIFACT_IDS
            )
        )
        or (
            safe["network_error_class"] is not None
            and (
                not isinstance(safe["network_error_class"], str)
                or safe["network_error_class"] not in NETWORK_ERROR_CLASSES
            )
        )
        or (
            safe["http_status"] is not None
            and (
                type(safe["http_status"]) is not int
                or not 100 <= safe["http_status"] <= 599
            )
        )
        or (
            safe["startup_stage"] is not None
            and (
                not isinstance(safe["startup_stage"], str)
                or safe["startup_stage"] not in STARTUP_STAGES
            )
        )
        or (
            safe["startup_exception_class"] is not None
            and (
                not isinstance(safe["startup_exception_class"], str)
                or safe["startup_exception_class"] not in STARTUP_EXCEPTION_CLASSES
            )
        )
        or (
            safe["binary_version_probe"] is not None
            and (
                not isinstance(safe["binary_version_probe"], str)
                or safe["binary_version_probe"] not in BINARY_VERSION_PROBE_RESULTS
            )
        )
        or (
            safe["binary_version"] is not None
            and (
                not isinstance(safe["binary_version"], str)
                or BOUNDED_VERSION_RE.fullmatch(safe["binary_version"]) is None
            )
        )
        or (
            safe["binary_version_exit_code"] is not None
            and (
                type(safe["binary_version_exit_code"]) is not int
                or not -255 <= safe["binary_version_exit_code"] <= 255
            )
        )
        or (
            safe["binary_version_probe"] == "passed"
            and (
                safe["binary_version"] is None
                or safe["binary_version_exit_code"] != 0
            )
        )
        or (
            safe["binary_version"] is not None
            and safe["binary_version_probe"] not in {"passed", "version_mismatch"}
        )
        or type(safe["marionette_port_ready"]) is not bool
        or type(safe["marionette_session_created"]) is not bool
        or (
            safe["marionette_session_created"]
            and (not safe["marionette_handshake"] or not safe["marionette_port_ready"])
        )
        or not isinstance(safe["child_state"], str)
        or safe["child_state"] not in CHILD_STATES
        or (
            safe["child_exit_code"] is not None
            and (
                type(safe["child_exit_code"]) is not int
                or not -255 <= safe["child_exit_code"] <= 255
                or safe["child_state"] != "exited"
            )
        )
        or any(
            type(safe[name]) is not bool
            for name in (
                "archive_sha256_verified",
                "archive_sha512_verified",
                "python_artifacts_verified",
                "docker_backend_verified",
                "docker_isolation_verified",
                "marionette_handshake",
                "main_window",
                "calendar_tab",
                "marionette_port_ready",
                "marionette_session_created",
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
            or not _permitted_pypi_package_url(item.get("url", ""), filename)
        ):
            raise SmokeFailure("preflight", "invalid_input")
        names.add(name.lower())
    if names != PYTHON_ARTIFACT_NAMES:
        raise SmokeFailure("preflight", "invalid_input")
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


def _permitted_pypi_package_url(url: str, filename: str) -> bool:
    if not _permitted_url(url, EXPECTED_PACKAGE_HOST, filename):
        return False
    parts = urllib.parse.urlparse(url).path.split("/")
    return (
        len(parts) == 6
        and parts[1] == "packages"
        and re.fullmatch(r"[0-9a-f]{2}", parts[2]) is not None
        and re.fullmatch(r"[0-9a-f]{2}", parts[3]) is not None
        and re.fullmatch(r"[0-9a-f]{60}", parts[4]) is not None
        and parts[5] == filename
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
    home_path = Path(home)
    if (
        not home
        or not home_path.is_absolute()
        or home != "/home/runner"
        or home_path == Path("/")
        or home_path.is_symlink()
        or not home_path.is_dir()
        or str(home_path) != os.path.normpath(home)
        or "," in home
    ):
        raise SmokeFailure("preflight", "unsupported_runner")


def _docker_image() -> str:
    image = os.environ.get("TB_DOCKER_IMAGE", "")
    if not re.fullmatch(r"thunderbird-calendar-smoke:[0-9a-f]{40}", image):
        raise SmokeFailure("preflight", "invalid_input")
    return image


def _container_name(suffix: str) -> str:
    run_id, attempt = _run_identity()
    if not re.fullmatch(r"[a-z0-9-]{1,16}", suffix):
        raise SmokeFailure("preflight", "invalid_input")
    return f"tbcal-{run_id}-{attempt}-{suffix}"


def _container_mount(source: Path, target: str, *, readonly: bool) -> str:
    if not target.startswith("/") or any(value in str(source) + target for value in (",", "\n", "\r")):
        raise SmokeFailure("preflight", "invalid_input")
    if source.is_symlink() or not source.exists():
        raise SmokeFailure("preflight", "invalid_input")
    try:
        resolved = source.resolve(strict=True)
        resolved.relative_to(ROOT_PARENT)
    except (OSError, ValueError):
        raise SmokeFailure("preflight", "invalid_input") from None
    suffix = ",readonly" if readonly else ""
    return f"type=bind,src={resolved},dst={target}{suffix}"


def _docker_command(
    suffix: str,
    command: list[str],
    *,
    home_source: Path,
    mounts: list[tuple[Path, str, bool]],
    extra_environment: dict[str, str] | None = None,
) -> tuple[list[str], str]:
    home = os.environ.get("HOME", "")
    if not home or Path(home).is_symlink():
        raise SmokeFailure("preflight", "unsupported_runner")
    name = _container_name(suffix)
    args = [
        "docker",
        "run",
        "--name",
        name,
        "--platform=linux/amd64",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "--pids-limit=256",
        "--ulimit",
        "core=0",
        "--ipc=private",
        "--shm-size=128m",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,mode=1777,size=128m",
        "-e",
        f"HOME={home}",
        "-e",
        "PATH=/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin",
        "-e",
        "LANG=C.UTF-8",
        "-e",
        "TMPDIR=/tmp",
        "-e",
        "XDG_CONFIG_HOME=/task/workspace/.xdg/config",
        "-e",
        "XDG_CACHE_HOME=/task/workspace/.xdg/cache",
        "-e",
        "XDG_DATA_HOME=/task/workspace/.xdg/data",
        "-e",
        "XDG_STATE_HOME=/task/workspace/.xdg/state",
        "-e",
        "XDG_RUNTIME_DIR=/tmp/runtime",
        "-e",
        "MOZ_HEADLESS=1",
        "-e",
        "PYTHONNOUSERSITE=1",
        "-e",
        "PYTHONDONTWRITEBYTECODE=1",
        "-e",
        "PIP_CONFIG_FILE=/dev/null",
        "-e",
        "PIP_DISABLE_PIP_VERSION_CHECK=1",
        "-e",
        "PIP_NO_INDEX=1",
    ]
    for source, target, readonly in mounts:
        args.extend(["--mount", _container_mount(source, target, readonly=readonly)])
    args.extend(["--mount", _container_mount(home_source, home, readonly=False)])
    for key, value in (extra_environment or {}).items():
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", key) or any(c in value for c in "\x00\n\r"):
            raise SmokeFailure("preflight", "invalid_input")
        args.extend(["-e", f"{key}={value}"])
    args.extend([_docker_image(), *command])
    return args, name


def _remove_container(name: str) -> None:
    if not re.fullmatch(r"tbcal-[0-9]{1,20}-[0-9]{1,4}-[a-z0-9-]{1,16}", name):
        raise SmokeFailure("complete", "cleanup_error")
    try:
        result = subprocess.run(
            ["docker", "container", "rm", "--force", name],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        raise SmokeFailure("complete", "cleanup_error") from None
    if result.returncode != 0:
        exists = subprocess.run(
            ["docker", "container", "inspect", name],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=15,
        )
        if exists.returncode == 0:
            raise SmokeFailure("complete", "cleanup_error")


def _docker_preflight() -> None:
    _validate_runner()
    if not shutil.which("docker"):
        raise SmokeFailure("preflight", "container_backend_unavailable")
    try:
        info = subprocess.run(
            ["docker", "info", "--format", "{{.OSType}}/{{.Architecture}}"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
            timeout=30,
        )
        image = subprocess.run(
            ["docker", "image", "inspect", "--format", "{{.Id}}", _docker_image()],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        raise SmokeFailure("preflight", "container_backend_unavailable") from None
    if (
        info.returncode != 0
        or info.stdout.strip() not in {"linux/amd64", "linux/x86_64"}
        or image.returncode != 0
        or not re.fullmatch(r"sha256:[0-9a-f]{64}", image.stdout.strip())
    ):
        raise SmokeFailure("preflight", "container_backend_unavailable")


def _probe_docker_isolation() -> None:
    _validate_runner()
    source = Path(__file__).resolve()
    try:
        source.relative_to(Path(os.environ["HOME"]).resolve())
    except ValueError:
        raise SmokeFailure("preflight", "unsupported_runner") from None
    probe = r'''
import json, os, runpy, socket, sys
host_pid_ns, host_mount_ns, source_path, expected_home, expected_uid, expected_gid = sys.argv[1:7]
status = {}
for line in open("/proc/self/status", encoding="ascii"):
    if ":" in line:
        key, value = line.split(":", 1)
        status[key] = value.strip()
mounts = {}
for line in open("/proc/self/mountinfo", encoding="ascii"):
    before, after = line.split(" - ", 1)
    fields = before.split()
    mountpoint = fields[4].replace("\\040", " ")
    mounts[mountpoint] = (fields[5].split(","), after.split()[0])
worker = "/input/thunderbird-calendar-smoke.py"
module = runpy.run_path(worker, run_name="tb_worker_probe")
lock = module["_load_lock"]()
home = os.environ["HOME"]
links = sorted(name for _, name in socket.if_nameindex())
routes = [line.split()[0] for line in open("/proc/net/route", encoding="ascii").read().splitlines()[1:] if line.split()]
s = socket.socket()
s.bind(("127.0.0.1", 0))
s.listen(1)
c = socket.create_connection(s.getsockname(), timeout=2)
a, _ = s.accept()
a.close(); c.close(); s.close()
probe_file = "/task/workspace/.docker-probe"
with open(probe_file, "x", encoding="ascii") as output:
    output.write("ok")
os.unlink(probe_file)
caps_zero = all(int(status.get(key, "1"), 16) == 0 for key in ("CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"))
input_stat = os.stat(worker)
lock_stat = os.stat("/input/thunderbird-calendar-smoke-artifacts.json")
home_stat = os.stat(home)
observation = {
    "uid": os.getuid(), "euid": os.geteuid(), "gid": os.getgid(), "egid": os.getegid(),
    "self_pid": os.getpid(), "pid_ns": os.readlink("/proc/self/ns/pid"), "host_pid_ns": host_pid_ns,
    "mount_ns": os.readlink("/proc/self/ns/mnt"), "host_mount_ns": host_mount_ns,
    "caps_zero": caps_zero, "no_new_privs": status.get("NoNewPrivs") == "1",
    "seccomp_mode": status.get("Seccomp"), "root_readonly": "ro" in mounts.get("/", ([], ""))[0],
    "input_readonly": "ro" in mounts.get("/input", ([], ""))[0],
    "app_readonly": "ro" in mounts.get("/task/app", ([], ""))[0],
    "venv_readonly": "ro" in mounts.get("/task/venv", ([], ""))[0],
    "wheels_readonly": "ro" in mounts.get("/wheels", ([], ""))[0],
    "workspace_readwrite": "rw" in mounts.get("/task/workspace", ([], ""))[0],
    "home_readwrite": "rw" in mounts.get(home, ([], ""))[0],
    "home": home, "home_empty": os.listdir(home) == [],
    "home_owned": home_stat.st_uid == os.getuid() and home_stat.st_gid == os.getgid(),
    "input_not_writable": input_stat.st_mode & 0o222 == 0 and lock_stat.st_mode & 0o222 == 0,
    "source_hidden": not os.path.exists(source_path),
    "worker_imported": callable(module.get("_smoke_worker")), "lock_loaded": len(lock.get("packages", [])) == 20,
    "workspace_write": True, "interfaces": links, "routes": routes, "loopback": True,
    "python": list(sys.version_info[:2]), "expected_home": expected_home,
    "expected_uid": int(expected_uid), "expected_gid": int(expected_gid),
}
print(json.dumps(observation, sort_keys=True))
'''
    try:
        with tempfile.TemporaryDirectory(prefix="tb-docker-probe-", dir=ROOT_PARENT) as temporary:
            root = Path(temporary)
            input_dir = root / "input"
            app_dir = root / "app"
            venv_dir = root / "venv"
            wheels_dir = root / "wheels"
            home_dir = root / "home"
            workspace = root / "workspace"
            for path in (input_dir, app_dir, venv_dir, wheels_dir, home_dir, workspace):
                path.mkdir(mode=0o700)
            (input_dir / WORKER_FILENAME).write_bytes(source.read_bytes())
            os.chmod(input_dir / WORKER_FILENAME, 0o400)
            lock_source = LOCK_PATH.resolve(strict=True)
            (input_dir / LOCK_FILENAME).write_bytes(lock_source.read_bytes())
            os.chmod(input_dir / LOCK_FILENAME, 0o400)
            mounts = [
                (input_dir, "/input", True),
                (app_dir, "/task/app", True),
                (venv_dir, "/task/venv", True),
                (wheels_dir, "/wheels", True),
                (workspace, "/task/workspace", False),
            ]
            command, name = _docker_command(
                "probe",
                [
                    "/usr/local/bin/python3",
                    "-B",
                    "-c",
                    probe,
                    os.readlink("/proc/self/ns/pid"),
                    os.readlink("/proc/self/ns/mnt"),
                    str(source),
                    os.environ["HOME"],
                    str(os.getuid()),
                    str(os.getgid()),
                ],
                home_source=home_dir,
                mounts=mounts,
            )
            try:
                result = subprocess.run(
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    text=True,
                    check=False,
                    timeout=30,
                )
                observation = json.loads(result.stdout) if result.returncode == 0 else {}
            except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
                raise SmokeFailure("preflight", "container_isolation_unavailable") from None
            finally:
                _remove_container(name)
    except SmokeFailure:
        raise
    except (OSError, ValueError, json.JSONDecodeError):
        raise SmokeFailure("preflight", "container_isolation_unavailable") from None
    valid = (
        observation.get("uid") == observation.get("expected_uid") == os.getuid() != 0
        and observation.get("euid") == os.geteuid() != 0
        and observation.get("gid") == observation.get("expected_gid") == os.getgid()
        and observation.get("egid") == os.getegid()
        and observation.get("self_pid") == 1
        and observation.get("pid_ns") != observation.get("host_pid_ns")
        and observation.get("mount_ns") != observation.get("host_mount_ns")
        and observation.get("caps_zero") is True
        and observation.get("no_new_privs") is True
        and observation.get("seccomp_mode") == "2"
        and observation.get("root_readonly") is True
        and observation.get("input_readonly") is True
        and observation.get("app_readonly") is True
        and observation.get("venv_readonly") is True
        and observation.get("wheels_readonly") is True
        and observation.get("workspace_readwrite") is True
        and observation.get("home_readwrite") is True
        and observation.get("home") == observation.get("expected_home") == os.environ["HOME"]
        and observation.get("home_empty") is True
        and observation.get("home_owned") is True
        and observation.get("input_not_writable") is True
        and observation.get("source_hidden") is True
        and observation.get("worker_imported") is True
        and observation.get("lock_loaded") is True
        and observation.get("workspace_write") is True
        and observation.get("interfaces") == ["lo"]
        and all(route == "lo" for route in observation.get("routes", []))
        and observation.get("loopback") is True
        and observation.get("python") == [3, 13]
    )
    if not valid:
        raise SmokeFailure("preflight", "container_isolation_unavailable")


def _artifact_id(record: dict[str, Any], host: str) -> str:
    if host == EXPECTED_ARCHIVE_HOST:
        return "mozilla_archive"
    if host != EXPECTED_PACKAGE_HOST:
        raise SmokeFailure("download", "invalid_input")
    name = record.get("name", "")
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
        raise SmokeFailure("download", "invalid_input")
    normalized = re.sub(r"[^a-z0-9_]", "_", name.lower())
    artifact_id = f"python_{normalized}"
    if artifact_id not in FAILED_ARTIFACT_IDS:
        raise SmokeFailure("download", "invalid_input")
    return artifact_id


def _network_error_class(error: BaseException) -> str:
    if isinstance(error, SmokeFailure):
        return error.network_error_class or "unknown"
    if isinstance(error, urllib.error.HTTPError):
        status = _http_error_status(error)
        if status is None:
            return "http_status"
        if 400 <= status < 500:
            return "http_4xx"
        if 500 <= status < 600:
            return "http_5xx"
        return "http_status"
    if isinstance(error, http.client.IncompleteRead):
        return "incomplete_transfer"
    if isinstance(error, http.client.HTTPException):
        return "invalid_response"
    if isinstance(error, urllib.error.URLError):
        reason = error.reason
        if isinstance(reason, BaseException) and reason is not error:
            return _network_error_class(reason)
        return "url_error"
    if isinstance(error, socket.gaierror):
        return "dns"
    if isinstance(error, (TimeoutError, socket.timeout)):
        return "timeout"
    if isinstance(error, ssl.SSLError):
        return "tls"
    if isinstance(error, ConnectionError):
        return "connection"
    if isinstance(error, ValueError):
        return "invalid_response"
    if isinstance(error, OSError):
        return "io_error"
    return "unknown"


def _http_error_status(error: BaseException) -> int | None:
    if not isinstance(error, urllib.error.HTTPError):
        return None
    status = error.code
    if type(status) is not int or not 100 <= status <= 599:
        return None
    return status


def _download_failure(artifact_id: str, error: BaseException) -> SmokeFailure:
    return SmokeFailure(
        "download",
        "network_error",
        failed_artifact=artifact_id,
        network_error_class=_network_error_class(error),
        http_status=_http_error_status(error),
    )


class _PinnedRedirectHandler(urllib.request.HTTPRedirectHandler):
    def __init__(self, host: str, filename: str, artifact_id: str):
        super().__init__()
        self.host = host
        self.filename = filename
        self.artifact_id = artifact_id

    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
        if not _permitted_url(newurl, self.host, self.filename):
            raise SmokeFailure(
                "download",
                "network_error",
                failed_artifact=self.artifact_id,
                network_error_class="redirect",
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


@contextmanager
def _total_wall_deadline(seconds: int, phase: str) -> Iterator[None]:
    if signal.getitimer(signal.ITIMER_REAL)[0] > 0:
        raise SmokeFailure(phase, "network_error", network_error_class="total_deadline")
    previous = signal.getsignal(signal.SIGALRM)

    def expired(_signum: int, _frame: Any) -> None:
        raise SmokeFailure(phase, "network_error", network_error_class="total_deadline")

    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def _download(record: dict[str, Any], destination: Path, host: str, *, both_hashes: bool = False) -> None:
    artifact_id = _artifact_id(record, host)
    if not _permitted_url(record.get("url", ""), host, record.get("filename", "")):
        raise SmokeFailure("download", "invalid_input", failed_artifact=artifact_id)
    request = urllib.request.Request(
        record["url"],
        headers={"User-Agent": "matrix-calendar-thunderbird-smoke/1", "Accept-Encoding": "identity"},
    )
    handler = _PinnedRedirectHandler(host, record["filename"], artifact_id)
    opener = urllib.request.build_opener(handler)
    sha256 = hashlib.sha256()
    sha512 = hashlib.sha512() if both_hashes else None
    written = 0
    try:
        response = opener.open(request, timeout=DOWNLOAD_TIMEOUT_SECONDS)
    except SmokeFailure as failure:
        if failure.error_class == "network_error":
            raise _download_failure(artifact_id, failure) from None
        raise
    except (
        OSError,
        urllib.error.URLError,
        ValueError,
        http.client.IncompleteRead,
        http.client.HTTPException,
    ) as error:
        raise _download_failure(artifact_id, error) from None
    try:
        with response:
            if not _permitted_url(response.geturl(), host, record["filename"]):
                raise SmokeFailure(
                    "download",
                    "network_error",
                    failed_artifact=artifact_id,
                    network_error_class="redirect",
                )
            length = response.headers.get("Content-Length")
            if length:
                try:
                    content_length = int(length)
                except ValueError:
                    raise SmokeFailure(
                        "download",
                        "network_error",
                        failed_artifact=artifact_id,
                        network_error_class="invalid_response",
                    ) from None
                if content_length != record["size"]:
                    raise SmokeFailure("hash_verification", "artifact_mismatch", failed_artifact=artifact_id)
            try:
                descriptor = os.open(
                    destination,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                    0o600,
                )
            except OSError:
                raise SmokeFailure("download", "internal_error", failed_artifact=artifact_id) from None
            try:
                with os.fdopen(descriptor, "wb") as output:
                    while True:
                        try:
                            block = response.read(1024 * 1024)
                        except (
                            OSError,
                            urllib.error.URLError,
                            ValueError,
                            http.client.IncompleteRead,
                            http.client.HTTPException,
                        ) as error:
                            raise _download_failure(artifact_id, error) from None
                        if not block:
                            break
                        written += len(block)
                        if written > record["size"]:
                            raise SmokeFailure("hash_verification", "artifact_mismatch", failed_artifact=artifact_id)
                        try:
                            output.write(block)
                        except OSError:
                            raise SmokeFailure("download", "internal_error", failed_artifact=artifact_id) from None
                        sha256.update(block)
                        if sha512 is not None:
                            sha512.update(block)
                    try:
                        output.flush()
                        os.fsync(output.fileno())
                    except OSError:
                        raise SmokeFailure("download", "internal_error", failed_artifact=artifact_id) from None
            except SmokeFailure:
                raise
            except OSError:
                raise SmokeFailure("download", "internal_error", failed_artifact=artifact_id) from None
    except SmokeFailure as failure:
        if failure.error_class == "network_error" and failure.failed_artifact is None:
            raise _download_failure(artifact_id, failure) from None
        raise
    except (
        OSError,
        urllib.error.URLError,
        ValueError,
        http.client.IncompleteRead,
        http.client.HTTPException,
    ) as error:
        raise _download_failure(artifact_id, error) from None
    expected256 = record["sha256"]
    if written != record["size"] or sha256.hexdigest() != expected256:
        raise SmokeFailure("hash_verification", "artifact_mismatch", failed_artifact=artifact_id)
    if sha512 is not None and sha512.hexdigest() != record["sha512"]:
        raise SmokeFailure("hash_verification", "artifact_mismatch", failed_artifact=artifact_id)


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
        "worker",
        "home",
        "logs",
    ):
        (root / name).mkdir(mode=0o700)
    for name in ("config", "cache", "data", "state"):
        (root / "workspace" / ".xdg" / name).mkdir(parents=True, mode=0o700)


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


def _require_preflight(source_sha: str) -> dict[str, Any]:
    try:
        value = json.loads(_summary_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise SmokeFailure("preflight", "invalid_input") from None
    if (
        value.get("schema") != "thunderbird-calendar-startup-smoke@5"
        or value.get("source_sha") != source_sha
        or value.get("docker_backend_verified") is not True
        or value.get("docker_isolation_verified") is not True
    ):
        raise SmokeFailure("preflight", "invalid_input")
    return value


def _run_bounded(
    command: list[str],
    *,
    log_path: Path,
    timeout: int,
    timeout_phase: str = "dependency_install",
    timeout_class: str = "dependency_error",
    failure_phase: str = "dependency_install",
    failure_class: str = "dependency_error",
    container_name: str | None = None,
) -> int:
    try:
        with log_path.open("ab") as log:
            os.chmod(log_path, 0o600)
            process = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                return process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                if container_name is not None:
                    try:
                        subprocess.run(
                            ["docker", "kill", container_name],
                            stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            check=False,
                            timeout=10,
                        )
                    except (OSError, subprocess.SubprocessError):
                        pass
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


def _run_container_bounded(
    suffix: str,
    command: list[str],
    *,
    root: Path,
    mounts: list[tuple[Path, str, bool]],
    log_path: Path,
    timeout: int,
    timeout_phase: str,
    timeout_class: str,
    failure_phase: str,
    failure_class: str,
) -> int:
    docker_command, name = _docker_command(
        suffix,
        command,
        home_source=root / "home",
        mounts=mounts,
    )
    try:
        return _run_bounded(
            docker_command,
            log_path=log_path,
            timeout=timeout,
            timeout_phase=timeout_phase,
            timeout_class=timeout_class,
            failure_phase=failure_phase,
            failure_class=failure_class,
            container_name=name,
        )
    finally:
        _remove_container(name)


def _capture_container(
    suffix: str,
    command: list[str],
    *,
    root: Path,
    mounts: list[tuple[Path, str, bool]],
    timeout: int,
    failure_phase: str,
    failure_class: str,
) -> str:
    docker_command, name = _docker_command(
        suffix,
        command,
        home_source=root / "home",
        mounts=mounts,
    )
    try:
        try:
            result = subprocess.run(
                docker_command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                check=False,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            try:
                subprocess.run(
                    ["docker", "kill", name],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                    timeout=10,
                )
            except (OSError, subprocess.SubprocessError):
                pass
            raise SmokeFailure(failure_phase, failure_class) from None
        except (OSError, subprocess.SubprocessError):
            raise SmokeFailure(failure_phase, failure_class) from None
        if result.returncode != 0:
            raise SmokeFailure(failure_phase, failure_class)
        return result.stdout
    finally:
        _remove_container(name)


def _prepare(payload: dict[str, Any], source_sha: str, root: Path, data: dict[str, Any]) -> None:
    previous = _require_preflight(source_sha)
    payload["docker_backend_verified"] = previous["docker_backend_verified"]
    payload["docker_isolation_verified"] = previous["docker_isolation_verified"]
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
        worker_dir = root / "worker"
        worker = worker_dir / WORKER_FILENAME
        worker.write_bytes(Path(__file__).resolve().read_bytes())
        os.chmod(worker, 0o400)
        lock = worker_dir / LOCK_FILENAME
        lock.write_bytes(LOCK_PATH.read_bytes())
        os.chmod(lock, 0o400)
        os.chmod(worker_dir, 0o700)
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
    _verify_owner(root, os.environ["GITHUB_SHA"])
    mounts = [
        (root / "python-artifacts", "/wheels", True),
        (root / "venv", "/task/venv", False),
        (root / "workspace", "/task/workspace", False),
    ]
    log_path = root / "logs" / "dependency-install.log"
    timeout_settings = {
        "timeout_phase": "dependency_install",
        "timeout_class": "dependency_error",
        "failure_phase": "dependency_install",
        "failure_class": "dependency_error",
    }
    if _run_container_bounded(
        "venv",
        ["/usr/local/bin/python3", "-B", "-m", "venv", "/task/venv"],
        root=root,
        mounts=mounts,
        log_path=log_path,
        timeout=60,
        **timeout_settings,
    ) != 0:
        raise SmokeFailure("dependency_install", "dependency_error")
    pip_python = "/task/venv/bin/python"
    common = [
        pip_python,
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
    bootstrap = [f"/wheels/{item['filename']}" for item in packages if item["name"] in bootstrap_names]
    runtime = [f"/wheels/{item['filename']}" for item in packages if item["name"] not in bootstrap_names]
    for suffix, paths in (("pip-bootstrap", bootstrap), ("pip-runtime", runtime)):
        if _run_container_bounded(
            suffix,
            common + paths,
            root=root,
            mounts=mounts,
            log_path=log_path,
            timeout=COMMAND_TIMEOUT_SECONDS,
            **timeout_settings,
        ) != 0:
            raise SmokeFailure("dependency_install", "dependency_error")
    if _run_container_bounded(
        "pip-check",
        [pip_python, "-B", "-m", "pip", "check"],
        root=root,
        mounts=mounts,
        log_path=log_path,
        timeout=30,
        **timeout_settings,
    ) != 0:
        raise SmokeFailure("dependency_install", "dependency_error")
    inventory_code = (
        "import importlib.metadata as m,json; "
        "print(json.dumps(sorted((d.metadata['Name'].lower().replace('_','-'),d.version) "
        "for d in m.distributions() if d.metadata.get('Name'))))"
    )
    try:
        output = _capture_container(
            "pip-inventory",
            [pip_python, "-B", "-c", inventory_code],
            root=root,
            mounts=mounts,
            timeout=30,
            failure_phase="dependency_install",
            failure_class="dependency_error",
        )
        installed = set(map(tuple, json.loads(output)))
    except (json.JSONDecodeError, TypeError):
        raise SmokeFailure("dependency_install", "dependency_error") from None
    expected = {(item["name"].lower().replace("_", "-"), item["version"]) for item in packages}
    extras = {item for item in installed if item[0] != "pip"} - expected
    missing = expected - installed
    if extras or missing:
        raise SmokeFailure("dependency_install", "dependency_error")
    driver_check = _run_container_bounded(
        "driver-check",
        [pip_python, "-B", "-c", "from marionette_driver.geckoinstance import apps; assert 'thunderbird' in apps"],
        root=root,
        mounts=mounts,
        log_path=log_path,
        timeout=30,
        **timeout_settings,
    )
    if driver_check != 0:
        raise SmokeFailure("dependency_install", "dependency_error")


def _worker_result_path(root: Path) -> Path:
    return root / "workspace" / ".smoke-result.json"


def _startup_exception_class(error: BaseException) -> str:
    name = type(error).__name__
    return name if name in STARTUP_EXCEPTION_CLASSES else "other"


def _bounded_version(output: Any) -> str | None:
    if not isinstance(output, str) or len(output) > MAX_VERSION_OUTPUT_CHARS:
        return None
    match = BOUNDED_VERSION_RE.search(output)
    return match.group(1) if match is not None else None


def _bounded_exit_code(value: Any) -> bool:
    return type(value) is int and -255 <= value <= 255


def _sanitize_startup_probe_stderr(value: Any) -> str:
    if isinstance(value, bytes):
        text = value[:MAX_STARTUP_DIAGNOSTIC_BYTES].decode("utf-8", errors="replace")
    elif isinstance(value, str):
        text = value.encode("utf-8", errors="replace")[
            :MAX_STARTUP_DIAGNOSTIC_BYTES
        ].decode("utf-8", errors="ignore")
    else:
        return ""
    text = ANSI_ESCAPE_RE.sub("", text)
    text = STARTUP_URL_RE.sub("[redacted-url]", text)
    text = ABSOLUTE_PATH_RE.sub("[redacted-path]", text)
    text = "".join(
        character for character in text if character.isprintable() or character == " "
    )
    text = re.sub(r"\s+", " ", text).strip()
    return text.encode("utf-8")[: MAX_STARTUP_DIAGNOSTIC_BYTES - 1].decode(
        "utf-8", errors="ignore"
    )


def _worker_startup_diagnostic_path(root: Path) -> Path:
    return root / "workspace" / WORKER_STARTUP_DIAGNOSTIC


def _host_startup_diagnostic_path() -> Path:
    return _summary_path().parent / HOST_STARTUP_DIAGNOSTIC


def _clear_host_startup_diagnostic() -> None:
    path = _host_startup_diagnostic_path()
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return
    except OSError:
        raise SmokeFailure("startup", "invalid_input") from None
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != os.getuid()
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != 0o600
        or metadata.st_size > MAX_STARTUP_DIAGNOSTIC_BYTES + 1
    ):
        raise SmokeFailure("startup", "invalid_input")
    try:
        path.unlink()
    except OSError:
        raise SmokeFailure("startup", "invalid_input") from None


def _write_worker_startup_diagnostic(root: Path, stderr: Any) -> None:
    diagnostic = _sanitize_startup_probe_stderr(stderr)
    if not diagnostic:
        return
    path = _worker_startup_diagnostic_path(root)
    try:
        descriptor = os.open(
            path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
    except OSError:
        return
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(diagnostic + "\n")
            output.flush()
            os.fsync(output.fileno())
    except OSError:
        try:
            path.unlink()
        except OSError:
            pass


def _persist_worker_startup_diagnostic(root: Path, result: dict[str, Any]) -> None:
    version_probe_failed = result.get("binary_version_probe") == "nonzero_exit"
    constructor_failed = (
        result.get("startup_stage") == "marionette_constructor"
        and result.get("startup_exception_class") is not None
    )
    if not (version_probe_failed or constructor_failed):
        return
    source = _worker_startup_diagnostic_path(root)
    try:
        metadata = source.lstat()
        if (
            source.is_symlink()
            or not source.is_file()
            or metadata.st_size > MAX_STARTUP_DIAGNOSTIC_BYTES
        ):
            return
        with source.open("rb") as input_file:
            diagnostic = _sanitize_startup_probe_stderr(
                input_file.read(MAX_STARTUP_DIAGNOSTIC_BYTES)
            )
    except OSError:
        return
    if not diagnostic:
        return
    destination = _host_startup_diagnostic_path()
    try:
        descriptor = os.open(
            destination,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
    except OSError:
        return
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(diagnostic + "\n")
            output.flush()
            os.fsync(output.fileno())
    except OSError:
        try:
            destination.unlink()
        except OSError:
            pass
        return
    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        try:
            with Path(output_path).open("a", encoding="utf-8") as output:
                output.write("startup_diagnostic_available=true\n")
        except OSError:
            pass


def _probe_binary_version(binary: Path, result: dict[str, Any], root: Path) -> bool:
    result["startup_stage"] = "binary_version_probe"
    try:
        completed = subprocess.run(
            [str(binary), "--version"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=MAX_STARTUP_PROBE_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        result["binary_version_probe"] = "timeout"
        result["startup_exception_class"] = _startup_exception_class(error)
        result["error_class"] = "marionette_error"
        return False
    except OSError as error:
        result["binary_version_probe"] = "spawn_error"
        result["startup_exception_class"] = _startup_exception_class(error)
        result["error_class"] = "marionette_error"
        return False
    except Exception as error:
        result["binary_version_probe"] = "spawn_error"
        result["startup_exception_class"] = _startup_exception_class(error)
        result["error_class"] = "marionette_error"
        return False
    if not _bounded_exit_code(completed.returncode):
        result["binary_version_probe"] = "spawn_error"
        result["error_class"] = "marionette_error"
        return False
    result["binary_version_exit_code"] = completed.returncode
    if completed.returncode != 0:
        result["binary_version_probe"] = "nonzero_exit"
        result["error_class"] = "marionette_error"
        _write_worker_startup_diagnostic(root, completed.stderr)
        return False
    version = _bounded_version(completed.stdout)
    if version is None:
        result["binary_version_probe"] = "unparseable"
        result["error_class"] = "marionette_error"
        return False
    result["binary_version"] = version
    if version != "158.0.1":
        result["binary_version_probe"] = "version_mismatch"
        result["error_class"] = "marionette_error"
        return False
    result["binary_version_probe"] = "passed"
    return True


def _marionette_port_ready(marionette: Any) -> bool:
    try:
        host = getattr(marionette, "host", "localhost")
        port = getattr(marionette, "port", None)
        if host not in {"localhost", "127.0.0.1", "::1"} or type(port) is not int or not 1 <= port <= 65535:
            return False
        with socket.create_connection((host, port), timeout=0.25):
            return True
    except Exception:
        return False


def _observe_marionette_child(result: dict[str, Any], marionette: Any) -> None:
    try:
        instance = getattr(marionette, "instance", None)
        runner = getattr(instance, "runner", None)
        handler = getattr(runner, "process_handler", None)
        if handler is None:
            handler = getattr(instance, "process_handler", None)
        process = getattr(handler, "proc", None)
        if process is None:
            process = getattr(handler, "process", None)
        poll = getattr(process, "poll", None)
        if not callable(poll):
            return
        exit_code = poll()
    except Exception:
        return
    if exit_code is None:
        result["child_state"] = "running"
    elif _bounded_exit_code(exit_code):
        result["child_state"] = "exited"
        result["child_exit_code"] = exit_code


def _smoke_worker(root: Path) -> int:
    result: dict[str, Any] = {
        "marionette_handshake": False,
        "main_window": False,
        "calendar_tab": False,
        "app_version": None,
        "error_class": None,
        "startup_stage": "worker_setup",
        "startup_exception_class": None,
        "binary_version_probe": None,
        "binary_version": None,
        "binary_version_exit_code": None,
        "marionette_port_ready": False,
        "marionette_session_created": False,
        "child_state": "unknown",
        "child_exit_code": None,
    }
    result_path = _worker_result_path(root)
    profile_path: Path | None = None
    marionette = None
    try:
        if root != CONTAINER_TASK_ROOT:
            raise SmokeFailure("preflight", "invalid_input")
        for name in ("config", "cache", "data", "state"):
            xdg_path = root / "workspace" / ".xdg" / name
            xdg_path.mkdir(parents=True, mode=0o700, exist_ok=True)
            os.chmod(xdg_path, 0o700)
        runtime = Path(os.environ["XDG_RUNTIME_DIR"])
        if runtime != CONTAINER_RUNTIME_DIR:
            raise SmokeFailure("preflight", "invalid_input")
        runtime.mkdir(mode=0o700, exist_ok=True)
        os.chmod(runtime, 0o700)
        binary = root / "app" / "thunderbird" / "thunderbird"
        if not _probe_binary_version(binary, result, root):
            return 1
        result["startup_stage"] = "marionette_import"
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
        result["startup_stage"] = "marionette_constructor"
        marionette = Marionette(
            bin=str(binary),
            app="thunderbird",
            workspace=str(root / "workspace"),
            gecko_log=str(root / "workspace" / "gecko.log"),
            app_args=["--calendar", "--headless"],
            prefs=prefs,
            headless=False,
            startup_timeout=85,
        )
        result["startup_stage"] = "profile_validation"
        profile_path = Path(marionette.profile_path).resolve()
        profile_path.relative_to((root / "workspace").resolve())
        result["startup_stage"] = "port_probe"
        result["marionette_port_ready"] = _marionette_port_ready(marionette)
        result["startup_stage"] = "session_creation"
        capabilities = marionette.start_session()
        result["marionette_handshake"] = True
        result["marionette_session_created"] = True
        result["marionette_port_ready"] = True
        _observe_marionette_child(result, marionette)
        version = capabilities.get("browserVersion")
        if isinstance(version, str) and re.fullmatch(r"[0-9]+\.[0-9]+(?:\.[0-9]+)?", version):
            result["app_version"] = version
        result["startup_stage"] = "main_window_check"
        marionette.set_context(marionette.CONTEXT_CHROME)
        result["main_window"] = marionette.get_window_type() == "mail:3pane"
        result["startup_stage"] = "calendar_tab_check"
        modes = marionette.execute_script(
            "const tabs = document.getElementById('tabmail'); "
            "return tabs.tabInfo.map(info => info.mode.name);"
        )
        result["calendar_tab"] = isinstance(modes, list) and "calendar" in modes
        if result["app_version"] != "158.0.1" or not result["main_window"] or not result["calendar_tab"]:
            result["error_class"] = "marionette_error"
            return 1
        result["startup_stage"] = "complete"
        return 0
    except Exception as error:
        result["error_class"] = "marionette_error"
        result["startup_exception_class"] = _startup_exception_class(error)
        if result["startup_stage"] == "marionette_constructor":
            _write_worker_startup_diagnostic(
                root,
                f"{result['startup_exception_class']}: {error}",
            )
        if marionette is not None:
            result["marionette_port_ready"] = (
                result["marionette_port_ready"] or _marionette_port_ready(marionette)
            )
            _observe_marionette_child(result, marionette)
        return 1
    finally:
        try:
            if marionette is not None:
                _observe_marionette_child(result, marionette)
                if marionette.session is not None:
                    marionette.quit(in_app=True)
                marionette.cleanup()
            if profile_path is not None:
                profile_path.relative_to((root / "workspace").resolve())
                if profile_path.exists():
                    shutil.rmtree(profile_path)
        except Exception as error:
            result["error_class"] = "cleanup_error"
            result["startup_stage"] = "worker_cleanup"
            result["startup_exception_class"] = _startup_exception_class(error)
        if result["error_class"] is None:
            result["startup_stage"] = "complete"
        result_path.write_text(json.dumps(result, sort_keys=True) + "\n", encoding="utf-8")
        os.chmod(result_path, 0o600)


def _read_worker_result(root: Path) -> dict[str, Any]:
    try:
        value = json.loads(_worker_result_path(root).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise SmokeFailure("startup", "marionette_error") from None
    expected_keys = {
        "marionette_handshake",
        "main_window",
        "calendar_tab",
        "app_version",
        "error_class",
        "startup_stage",
        "startup_exception_class",
        "binary_version_probe",
        "binary_version",
        "binary_version_exit_code",
        "marionette_port_ready",
        "marionette_session_created",
        "child_state",
        "child_exit_code",
    }
    if not isinstance(value, dict) or set(value) != expected_keys:
        raise SmokeFailure("startup", "marionette_error")
    if any(
        type(value[key]) is not bool
        for key in (
            "marionette_handshake",
            "main_window",
            "calendar_tab",
            "marionette_port_ready",
            "marionette_session_created",
        )
    ):
        raise SmokeFailure("startup", "marionette_error")
    if value["error_class"] not in (None, "marionette_error", "cleanup_error"):
        raise SmokeFailure("startup", "marionette_error")
    if (
        not isinstance(value["startup_stage"], str)
        or value["startup_stage"] not in STARTUP_STAGES
    ):
        raise SmokeFailure("startup", "marionette_error")
    if value["startup_exception_class"] not in (None, *STARTUP_EXCEPTION_CLASSES):
        raise SmokeFailure("startup", "marionette_error")
    if value["binary_version_probe"] not in (None, *BINARY_VERSION_PROBE_RESULTS):
        raise SmokeFailure("startup", "marionette_error")
    if (
        not isinstance(value["child_state"], str)
        or value["child_state"] not in CHILD_STATES
    ):
        raise SmokeFailure("startup", "marionette_error")
    for code_field in ("binary_version_exit_code", "child_exit_code"):
        if value[code_field] is not None and not _bounded_exit_code(value[code_field]):
            raise SmokeFailure("startup", "marionette_error")
    if value["child_exit_code"] is not None and value["child_state"] != "exited":
        raise SmokeFailure("startup", "marionette_error")
    binary_version = value["binary_version"]
    if binary_version is not None and (
        not isinstance(binary_version, str)
        or BOUNDED_VERSION_RE.fullmatch(binary_version) is None
    ):
        raise SmokeFailure("startup", "marionette_error")
    if value["binary_version_probe"] == "passed" and (
        binary_version is None or value["binary_version_exit_code"] != 0
    ):
        raise SmokeFailure("startup", "marionette_error")
    if binary_version is not None and value["binary_version_probe"] not in {
        "passed",
        "version_mismatch",
    }:
        raise SmokeFailure("startup", "marionette_error")
    if value["marionette_session_created"] and (
        not value["marionette_handshake"] or not value["marionette_port_ready"]
    ):
        raise SmokeFailure("startup", "marionette_error")
    version = value["app_version"]
    if version is not None and (
        not isinstance(version, str)
        or not re.fullmatch(r"[0-9]+\.[0-9]+(?:\.[0-9]+)?", version)
    ):
        raise SmokeFailure("startup", "marionette_error")
    return value


def _smoke(payload: dict[str, Any], source_sha: str, root: Path) -> None:
    _clear_host_startup_diagnostic()
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
        or prepared.get("docker_backend_verified") is not True
        or prepared.get("docker_isolation_verified") is not True
    ):
        raise SmokeFailure("preflight", "invalid_input")
    for name in (
        "archive_sha256_verified",
        "archive_sha512_verified",
        "python_artifacts_verified",
        "docker_backend_verified",
        "docker_isolation_verified",
    ):
        payload[name] = prepared[name]
    _docker_preflight()
    payload["phase"] = "startup"
    payload["startup_stage"] = "container_execution"
    mounts = [
        (root / "worker", "/input", True),
        (root / "app", "/task/app", True),
        (root / "venv", "/task/venv", True),
        (root / "workspace", "/task/workspace", False),
    ]
    worker = [
        "/task/venv/bin/python",
        "-B",
        "/input/thunderbird-calendar-smoke.py",
        "--container-worker",
        "/task",
    ]
    log_path = root / "logs" / "thunderbird-startup.log"
    try:
        code = _run_container_bounded(
            "startup",
            worker,
            root=root,
            mounts=mounts,
            log_path=log_path,
            timeout=SMOKE_TIMEOUT_SECONDS,
            timeout_phase="startup",
            timeout_class="startup_timeout",
            failure_phase="startup",
            failure_class="marionette_error",
        )
        try:
            result = _read_worker_result(root)
        except SmokeFailure:
            payload["startup_stage"] = "worker_result_read"
            raise
        _persist_worker_startup_diagnostic(root, result)
    except SmokeFailure:
        raise
    except (OSError, ValueError):
        raise SmokeFailure("startup", "marionette_error") from None
    payload.update(
        {
            key: result[key]
            for key in (
                "marionette_handshake",
                "main_window",
                "calendar_tab",
                "app_version",
                "startup_stage",
                "startup_exception_class",
                "binary_version_probe",
                "binary_version",
                "binary_version_exit_code",
                "marionette_port_ready",
                "marionette_session_created",
                "child_state",
                "child_exit_code",
            )
        }
    )
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
            "image": os.environ.get("TB_IMAGE_OUTCOME", ""),
            "preflight": os.environ.get("TB_PREFLIGHT_OUTCOME", ""),
            "prepare": os.environ.get("TB_PREPARE_OUTCOME", ""),
            "smoke": os.environ.get("TB_SMOKE_OUTCOME", ""),
        }
        failed = next((name for name, outcome in outcomes.items() if outcome == "failure"), None)
        payload["status"] = "failed"
        payload["error_class"] = {
            "image": "container_backend_unavailable",
            "preflight": "container_isolation_unavailable",
            "prepare": "dependency_error",
            "smoke": "marionette_error",
        }.get(failed, "internal_error")
        if failed in {"image", "preflight"}:
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
    parser.add_argument("--container-worker", metavar="TASK_ROOT")
    args = parser.parse_args()
    if args.container_worker:
        if Path(args.container_worker) != CONTAINER_TASK_ROOT:
            return 2
        return _smoke_worker(CONTAINER_TASK_ROOT)
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
            _docker_preflight()
            payload["docker_backend_verified"] = True
            _probe_docker_isolation()
            payload["docker_isolation_verified"] = True
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
        if failure.failed_artifact is not None:
            payload["failed_artifact"] = failure.failed_artifact
        if failure.network_error_class is not None:
            payload["network_error_class"] = failure.network_error_class
        if failure.http_status is not None:
            payload["http_status"] = failure.http_status
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
