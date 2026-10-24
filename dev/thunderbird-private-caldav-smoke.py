#!/usr/bin/env python3
"""Run the isolated native Thunderbird private CalDAV qualification profile."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from zipfile import ZipFile


SCRIPT_DIR = Path(__file__).resolve().parent
SMOKE_HELPER_PATH = SCRIPT_DIR / "thunderbird-calendar-smoke.py"
REQUIREMENTS_PATH = SCRIPT_DIR / "thunderbird-private-caldav-requirements.txt"
SMOKE_SPEC = importlib.util.spec_from_file_location(
    "thunderbird_calendar_smoke", SMOKE_HELPER_PATH
)
if SMOKE_SPEC is None or SMOKE_SPEC.loader is None:
    raise RuntimeError("Thunderbird smoke helper is unavailable")
SMOKE = importlib.util.module_from_spec(SMOKE_SPEC)
SMOKE_SPEC.loader.exec_module(SMOKE)

SUMMARY_SCHEMA = "thunderbird-private-caldav-summary@3"
RESULT_SCHEMA = "thunderbird-private-caldav-qualification@1"
WORKER_DIAGNOSTIC_SCHEMA = "thunderbird-private-caldav-worker-diagnostic@1"
CALDAV_CONTRACT_DIAGNOSTIC_SCHEMA = "private-caldav-contract-diagnostic@1"
EXPECTED_NODE_PREFIX = (22, 12, 0)
EXPECTED_WHEEL_COUNT = 19
WHEEL_TIMEOUT_SECONDS = 300
INSTALL_TIMEOUT_SECONDS = 180
NATIVE_TIMEOUT_SECONDS = 360
RESULT_FILENAME = "private-caldav-result.json"
JEST_REPORT_FILENAME = "private-caldav-jest-report.json"
WORKER_DIAGNOSTIC_FILENAME = "private-caldav-worker-diagnostic.json"
CALDAV_CONTRACT_DIAGNOSTIC_FILENAME = "private-caldav-contract-diagnostic.json"
MAX_JEST_REPORT_BYTES = 1_000_000
MAX_CALDAV_CONTRACT_DIAGNOSTIC_BYTES = 512
RESULT_FIELDS = {
    "calendarTab",
    "providerDiscovery",
    "calendarScope",
    "refreshNetworkRequest",
    "canonicalEditRoundtrip",
    "unknownPropertyPreserved",
    "canonicalCreateRoundtrip",
    "canonicalDeleteRoundtrip",
    "freshRevokeDenied",
    "callbackAdvancedAfterRevoke",
    "revokedState",
    "authDeniedAfterRevoke",
}
CALDAV_CONTRACT_PHASES = {
    "setup",
    "client_version",
    "callback_security",
    "principal_discovery",
    "calendar_discovery",
    "event_read",
    "etag_read",
    "event_update",
    "stale_etag",
    "event_create",
    "event_delete",
    "mixed_collection",
    "component_scope",
    "credential_isolation",
    "route_isolation",
    "room_discovery",
    "room_power_policy",
    "room_membership_policy",
    "personal_revocation",
    "complete",
}
CALDAV_CONTRACT_ERROR_CLASSES = {
    "setup_failed",
    "assertion_failed",
    "operation_failed",
}
CALDAV_CONTRACT_SUMMARY_STAGES = {
    f"python_contract_{phase}" for phase in CALDAV_CONTRACT_PHASES
}
CALDAV_CONTRACT_SUMMARY_CLASSES = {
    "setup_failed": "python_contract_setup_failed",
    "assertion_failed": "python_contract_assertion_failed",
    "operation_failed": "python_contract_operation_failed",
}
FIXTURE_FAILURE_STAGES = {
    "unknown",
    "jest_runner",
    "suite_load",
    "fixture_setup",
    "radicale_start",
    "native_worker",
    "native_result",
    "canonical_assert",
    "cleanup",
    "worker_setup",
    "application_startup",
    "calendar_tab",
    "provider_discovery",
    "provider_refresh",
    "provider_edit",
    "provider_create",
    "provider_delete",
    "provider_operation",
    "provider_network_request",
    "profile_ca_import",
    "control_state",
    "canonical_verification",
    "revoke_setup",
    "post_revoke_provider_request",
    "complete",
    "internal",
} | CALDAV_CONTRACT_SUMMARY_STAGES
FIXTURE_FAILURE_CLASSES = {
    "unknown",
    "jest_process_error",
    "jest_timeout",
    "jest_report_missing",
    "jest_report_invalid",
    "worker_input_invalid",
    "jest_suite_failed",
    "module_load_failed",
    "native_binding_failed",
    "typescript_transform_failed",
    "invalid_jest_config",
    "jest_assertion_failed",
    "radicale_not_ready",
    "caldav_contract_failed",
    "native_result_invalid",
    "unrecognized_native_failure",
    "provider_unavailable",
    "discovery_cardinality",
    "calendar_uri_missing",
    "calendar_scope_mismatch",
    "calendar_registration_data_missing",
    "calendar_not_registered",
    "discovery_failed",
    "calendar_unavailable",
    "refresh_failed",
    "event_not_loaded",
    "unknown_property_not_loaded",
    "event_edit_failed",
    "event_create_failed",
    "created_event_not_loaded",
    "event_delete_failed",
    "revoke_probe_failed",
    "contract_assertion",
    "control_state_invalid",
    "canonical_verification",
    "callback_not_observed",
    "profile_setup_failed",
    "marionette_error",
    "invalid_provider_result",
    "calendar_mode_unavailable",
    "calendar_tab_not_open",
    "input_missing",
    "invalid_workspace",
    "invalid_binary",
    "invalid_app_id",
    "invalid_origin",
    "version_mismatch",
    "main_window_missing",
    "provider_discovery_failed",
    "personal_client_not_active",
    "revoke_failed",
    "revoked_state_missing",
    "revoked_write_accepted",
    "revoked_state_lost",
    "auth_denial_not_observed",
    "qualification_predicate_failed",
    "cleanup_failed",
    "unexpected_error",
} | set(CALDAV_CONTRACT_SUMMARY_CLASSES.values())
NATIVE_FAILURE_PAIRS = {
    ("worker_setup", "input_missing"),
    ("worker_setup", "invalid_workspace"),
    ("worker_setup", "invalid_binary"),
    ("worker_setup", "invalid_app_id"),
    ("worker_setup", "invalid_origin"),
    ("application_startup", "version_mismatch"),
    ("application_startup", "main_window_missing"),
    ("calendar_tab", "marionette_error"),
    ("calendar_tab", "calendar_mode_unavailable"),
    ("calendar_tab", "calendar_tab_not_open"),
    ("provider_discovery", "provider_unavailable"),
    ("provider_discovery", "discovery_cardinality"),
    ("provider_discovery", "calendar_uri_missing"),
    ("provider_discovery", "calendar_scope_mismatch"),
    ("provider_discovery", "calendar_registration_data_missing"),
    ("provider_discovery", "calendar_not_registered"),
    ("provider_discovery", "discovery_failed"),
    ("provider_discovery", "provider_discovery_failed"),
    ("provider_refresh", "calendar_unavailable"),
    ("provider_refresh", "refresh_failed"),
    ("provider_edit", "event_not_loaded"),
    ("provider_edit", "unknown_property_not_loaded"),
    ("provider_edit", "event_edit_failed"),
    ("provider_create", "event_not_loaded"),
    ("provider_create", "event_create_failed"),
    ("provider_delete", "created_event_not_loaded"),
    ("provider_delete", "event_delete_failed"),
    ("post_revoke_provider_request", "event_not_loaded"),
    ("post_revoke_provider_request", "revoke_probe_failed"),
    ("provider_operation", "marionette_error"),
    ("provider_operation", "invalid_provider_result"),
    ("provider_network_request", "callback_not_observed"),
    ("profile_ca_import", "profile_setup_failed"),
    ("control_state", "contract_assertion"),
    ("canonical_verification", "contract_assertion"),
    ("revoke_setup", "personal_client_not_active"),
    ("revoke_setup", "revoke_failed"),
    ("revoke_setup", "revoked_state_missing"),
    ("post_revoke_provider_request", "revoked_write_accepted"),
    ("post_revoke_provider_request", "revoked_state_lost"),
    ("post_revoke_provider_request", "auth_denial_not_observed"),
    ("complete", "qualification_predicate_failed"),
    ("cleanup", "cleanup_failed"),
    ("internal", "unexpected_error"),
}
NATIVE_FAILURE_MESSAGE = re.compile(
    r"Native Thunderbird CalDAV contract failed \(([a-z_]{1,64})/([a-z_]{1,64})\)\."
)
JEST_TEXT_FAILURE_MARKERS = (
    (
        "native_binding_failed",
        (
            "err_dlopen_failed",
            "invalid elf header",
            "wrong elf class",
            "module did not self-register",
            "not a valid win32 application",
        ),
    ),
    (
        "module_load_failed",
        ("cannot find module ", "cannot find package ", "err_module_not_found"),
    ),
    (
        "typescript_transform_failed",
        (
            "jest encountered an unexpected token",
            "failed to transform",
            "failed to parse typescript",
            "cannot use import statement outside a module",
        ),
    ),
    (
        "invalid_jest_config",
        (
            "validation error:",
            "could not find a config file based on provided values:",
        ),
    ),
    (
        "jest_timeout",
        (
            "exceeded timeout of ",
            "test suite timed out",
            "timeout - async callback was not invoked",
        ),
    ),
)
FAILURE_CLASSES = {
    "cleanup_failed",
    "container_backend_unavailable",
    "container_isolation_unavailable",
    "dependency_download_failed",
    "dependency_install_failed",
    "invalid_input",
    "jest_failed",
    "node_runtime_missing",
    "native_result_invalid",
    "native_timeout",
    "preflight_failed",
    "startup_artifacts_preflight_failed",
    "workspace_preflight_failed",
    "internal_error",
}
PHASES = {"preflight", "prepare", "dependency_install", "fixture_run", "complete"}


def _summary_path() -> Path:
    runner_temp = os.environ.get("RUNNER_TEMP", "")
    if not runner_temp:
        raise ValueError("runner temp is not configured")
    parent = Path(runner_temp)
    if not parent.is_absolute() or parent.is_symlink() or not parent.is_dir():
        raise ValueError("runner temp is invalid")
    return parent / "thunderbird-private-caldav-summary.json"


def _initial_summary(source_sha: str) -> dict[str, Any]:
    return {
        "schema": SUMMARY_SCHEMA,
        "source_sha": source_sha,
        "status": "running",
        "phase": "preflight",
        "failure_class": None,
        "docker_backend_verified": False,
        "docker_isolation_verified": False,
        "workspace_jest_ready": False,
        "startup_artifacts_verified": False,
        "thunderbird_archive_verified": False,
        "marionette_artifacts_verified": False,
        "node_version": None,
        "caldav_wheels_verified": False,
        "caldav_wheel_count": 0,
        "caldav_wheel_bytes": 0,
        "private_dependencies_installed": False,
        "native_provider_passed": False,
        "fixture_failure_stage": None,
        "fixture_failure_class": None,
        "app_version": None,
        "calendarTab": False,
        "providerDiscovery": False,
        "calendarScope": False,
        "refreshNetworkRequest": False,
        "canonicalEditRoundtrip": False,
        "unknownPropertyPreserved": False,
        "canonicalCreateRoundtrip": False,
        "canonicalDeleteRoundtrip": False,
        "freshRevokeDenied": False,
        "callbackAdvancedAfterRevoke": False,
        "revokedState": False,
        "authDeniedAfterRevoke": False,
    }


def _write_summary(payload: dict[str, Any]) -> None:
    source_sha = payload.get("source_sha", "")
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        source_sha = "0" * 40
    safe = _initial_summary(source_sha)
    for key in safe:
        if key in payload:
            safe[key] = payload[key]
    if (
        safe["schema"] != SUMMARY_SCHEMA
        or safe["status"] not in {"running", "passed", "failed"}
        or safe["phase"] not in PHASES
        or safe["failure_class"] not in (None, *FAILURE_CLASSES)
        or any(
            type(safe[key]) is not bool
            for key in (
                "docker_backend_verified",
                "docker_isolation_verified",
                "workspace_jest_ready",
                "startup_artifacts_verified",
                "thunderbird_archive_verified",
                "marionette_artifacts_verified",
                "caldav_wheels_verified",
                "private_dependencies_installed",
                "native_provider_passed",
                *RESULT_FIELDS,
            )
        )
        or type(safe["caldav_wheel_count"]) is not int
        or not 0 <= safe["caldav_wheel_count"] <= EXPECTED_WHEEL_COUNT
        or type(safe["caldav_wheel_bytes"]) is not int
        or not 0 <= safe["caldav_wheel_bytes"] <= 100_000_000
        or (
            safe["node_version"] is not None
            and (
                not isinstance(safe["node_version"], str)
                or not re.fullmatch(r"22\.[0-9]{1,3}\.[0-9]{1,3}", safe["node_version"])
            )
        )
        or (
            safe["app_version"] is not None
            and safe["app_version"] != "158.0.1"
        )
        or (
            safe["fixture_failure_stage"] is not None
            and (
                not isinstance(safe["fixture_failure_stage"], str)
                or safe["fixture_failure_stage"] not in FIXTURE_FAILURE_STAGES
            )
        )
        or (
            safe["fixture_failure_class"] is not None
            and (
                not isinstance(safe["fixture_failure_class"], str)
                or safe["fixture_failure_class"] not in FIXTURE_FAILURE_CLASSES
            )
        )
        or (
            (safe["fixture_failure_stage"] is None)
            != (safe["fixture_failure_class"] is None)
        )
        or (
            safe["fixture_failure_stage"] is not None
            and (
                safe["status"] != "failed"
                or safe["phase"] not in {"fixture_run", "complete"}
            )
        )
    ):
        safe = _initial_summary("0" * 40)
        safe.update(
            {
                "status": "failed",
                "phase": "complete",
                "failure_class": "internal_error",
            }
        )
    path = _summary_path()
    temporary = path.with_suffix(".json.tmp")
    encoded = json.dumps(safe, sort_keys=True, separators=(",", ":")) + "\n"
    descriptor = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(encoded)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    os.chmod(path, 0o600)


def _load_summary() -> dict[str, Any]:
    try:
        value = json.loads(_summary_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise ValueError("qualification summary is invalid") from None
    if not isinstance(value, dict) or value.get("schema") != SUMMARY_SCHEMA:
        raise ValueError("qualification summary is invalid")
    return value


def _source_sha() -> str:
    value = os.environ.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("source identity is invalid")
    return value


def _task_root() -> Path:
    return SMOKE._root_path()


def _startup_artifacts_verified(value: Any, source_sha: str) -> bool:
    return (
        isinstance(value, dict)
        and value.get("schema") == "thunderbird-calendar-startup-smoke@6"
        and value.get("source_sha") == source_sha
        and value.get("status") == "running"
        and value.get("phase") == "dependency_install"
        and value.get("archive_sha256_verified") is True
        and value.get("archive_sha512_verified") is True
        and value.get("python_artifacts_verified") is True
        and value.get("docker_backend_verified") is True
        and value.get("docker_isolation_verified") is True
    )


def _owned_regular_file(path: Path) -> bool:
    try:
        metadata = path.lstat()
    except OSError:
        return False
    return stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.getuid()


def _owned_venv_python_link(root: Path) -> bool:
    venv = root / "venv"
    binary_directory = venv / "bin"
    interpreter = binary_directory / "python"
    try:
        venv_metadata = venv.lstat()
        bin_metadata = binary_directory.lstat()
        interpreter_metadata = interpreter.lstat()
    except OSError:
        return False
    return (
        stat.S_ISDIR(venv_metadata.st_mode)
        and venv_metadata.st_uid == os.getuid()
        and stat.S_ISDIR(bin_metadata.st_mode)
        and bin_metadata.st_uid == os.getuid()
        and stat.S_ISLNK(interpreter_metadata.st_mode)
        and interpreter_metadata.st_uid == os.getuid()
    )


def _require_startup_artifacts(root: Path, source_sha: str) -> None:
    summary_path = SMOKE._summary_path()
    try:
        metadata = summary_path.lstat()
        if (
            summary_path.is_symlink()
            or not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
        ):
            raise ValueError
        startup_summary = json.loads(summary_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        raise ValueError("startup artifact summary is invalid") from None
    binary = root / "app" / "thunderbird" / "thunderbird"
    marionette = root / "venv" / "lib" / "python3.13" / "site-packages" / "marionette_driver" / "marionette.py"
    if (
        not _startup_artifacts_verified(startup_summary, source_sha)
        or not _owned_regular_file(binary)
        or not _owned_venv_python_link(root)
        or not _owned_regular_file(marionette)
    ):
        raise ValueError("startup artifacts are unavailable")
    try:
        SMOKE._capture_container(
            "verify-venv",
            [
                "/task/venv/bin/python",
                "-B",
                "-c",
                "from marionette_driver.geckoinstance import apps; assert 'thunderbird' in apps",
            ],
            root=root,
            mounts=[(root / "venv", "/task/venv", True)],
            timeout=30,
            failure_phase="preflight",
            failure_class="invalid_input",
        )
    except SMOKE.SmokeFailure:
        raise ValueError("startup artifacts are unavailable") from None


def _require_prepared(source_sha: str, *, installed: bool = False) -> tuple[Path, dict[str, Any]]:
    root = _task_root()
    SMOKE._verify_owner(root, source_sha)
    summary = _load_summary()
    if (
        summary.get("source_sha") != source_sha
        or summary.get("docker_backend_verified") is not True
        or summary.get("docker_isolation_verified") is not True
        or summary.get("workspace_jest_ready") is not True
        or summary.get("startup_artifacts_verified") is not True
        or summary.get("thunderbird_archive_verified") is not True
        or summary.get("marionette_artifacts_verified") is not True
        or summary.get("caldav_wheels_verified") is not True
        or (installed and summary.get("private_dependencies_installed") is not True)
    ):
        raise ValueError("qualification preparation is incomplete")
    return root, summary


def _workspace() -> Path:
    value = os.environ.get("GITHUB_WORKSPACE", "")
    path = Path(value)
    if (
        not path.is_absolute()
        or path.is_symlink()
        or not path.is_dir()
        or not (path / "package.json").is_file()
        or not (path / "node_modules" / "jest" / "bin" / "jest.js").is_file()
    ):
        raise ValueError("workspace dependencies are unavailable")
    return path.resolve(strict=True)


def _requirements() -> dict[str, tuple[str, str]]:
    requirements: dict[str, tuple[str, str]] = {}
    for line in REQUIREMENTS_PATH.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(
            r"([A-Za-z0-9_.-]+)==([^ ]+) --hash=sha256:([0-9a-f]{64})",
            line,
        )
        if not match:
            raise ValueError("private CalDAV requirements lock is invalid")
        name, version, digest = match.groups()
        normalized = name.lower().replace("_", "-")
        if normalized in requirements:
            raise ValueError("private CalDAV requirements lock has duplicates")
        requirements[normalized] = (version, digest)
    if len(requirements) != EXPECTED_WHEEL_COUNT:
        raise ValueError("private CalDAV requirements lock is incomplete")
    return requirements


def _verify_wheelhouse(wheelhouse: Path) -> tuple[int, int]:
    expected = _requirements()
    if wheelhouse.is_symlink() or not wheelhouse.is_dir():
        raise ValueError("private CalDAV wheelhouse is invalid")
    files = sorted(wheelhouse.iterdir())
    if len(files) != EXPECTED_WHEEL_COUNT:
        raise ValueError("private CalDAV wheel count is invalid")
    observed: dict[str, tuple[str, str, int]] = {}
    total_bytes = 0
    for path in files:
        metadata = path.lstat()
        if (
            path.is_symlink()
            or not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or path.suffix != ".whl"
            or metadata.st_size <= 0
        ):
            raise ValueError("private CalDAV wheel artifact is invalid")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        with ZipFile(path) as archive:
            metadatas = [
                name for name in archive.namelist() if name.endswith(".dist-info/METADATA")
            ]
            if len(metadatas) != 1:
                raise ValueError("private CalDAV wheel metadata is invalid")
            fields = archive.read(metadatas[0]).decode("utf-8", "replace").splitlines()
        name = next((line[6:] for line in fields if line.startswith("Name: ")), "")
        version = next((line[9:] for line in fields if line.startswith("Version: ")), "")
        normalized = name.lower().replace("_", "-")
        locked = expected.get(normalized)
        if (
            locked is None
            or locked[0] != version
            or locked[1] != digest
            or normalized in observed
        ):
            raise ValueError("private CalDAV wheel does not match its lock")
        observed[normalized] = (version, digest, metadata.st_size)
        os.chmod(path, 0o400)
        total_bytes += metadata.st_size
    if set(observed) != set(expected):
        raise ValueError("private CalDAV wheelhouse does not match its lock")
    return len(observed), total_bytes


def _node_runtime(root: Path) -> tuple[str, Path]:
    if platform.machine() not in {"x86_64", "AMD64"}:
        raise ValueError("Node runtime architecture is unsupported")
    executable = shutil.which("node")
    tool_cache = os.environ.get("RUNNER_TOOL_CACHE", "")
    if not executable or not tool_cache:
        raise ValueError("setup-node runtime is unavailable")
    source = Path(executable).resolve(strict=True)
    node_cache = Path(tool_cache).resolve(strict=True) / "node"
    try:
        source.relative_to(node_cache)
    except ValueError:
        raise ValueError("Node runtime did not come from setup-node") from None
    try:
        probe = subprocess.run(
            [str(source), "--version"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="ascii",
            errors="replace",
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        raise ValueError("Node runtime could not be inspected") from None
    match = re.fullmatch(r"v(22)\.([0-9]{1,3})\.([0-9]{1,3})\s*", probe.stdout)
    if probe.returncode != 0 or not match:
        raise ValueError("Node runtime version is unsupported")
    version = tuple(int(part) for part in match.groups())
    if version < EXPECTED_NODE_PREFIX:
        raise ValueError("Node runtime is below the workspace engine floor")
    node_dir = root / "node"
    if node_dir.exists() or node_dir.is_symlink():
        raise ValueError("Node staging path already exists")
    node_dir.mkdir(mode=0o700)
    destination = node_dir / "node"
    shutil.copyfile(source, destination)
    os.chmod(destination, 0o500)
    return ".".join(str(part) for part in version), node_dir


def _download_private_wheels(root: Path) -> tuple[int, int]:
    wheelhouse = root / "private-caldav-wheels"
    if wheelhouse.exists() or wheelhouse.is_symlink():
        raise ValueError("private CalDAV wheelhouse already exists")
    wheelhouse.mkdir(mode=0o700)
    command = [
        sys.executable,
        "-B",
        "-m",
        "pip",
        "download",
        "--isolated",
        "--disable-pip-version-check",
        "--no-cache-dir",
        "--no-deps",
        "--only-binary=:all:",
        "--require-hashes",
        "--index-url",
        "https://pypi.org/simple",
        "--dest",
        str(wheelhouse),
        "-r",
        str(REQUIREMENTS_PATH),
    ]
    log_path = root / "logs" / "private-caldav-wheel-download.log"
    try:
        result = SMOKE._run_bounded(
            command,
            log_path=log_path,
            timeout=WHEEL_TIMEOUT_SECONDS,
            timeout_phase="dependency_install",
            timeout_class="dependency_error",
            failure_phase="dependency_install",
            failure_class="dependency_error",
        )
    except Exception:
        raise ValueError("private CalDAV wheel download failed") from None
    if result != 0:
        raise ValueError("private CalDAV wheel download failed")
    return _verify_wheelhouse(wheelhouse)


def _prepare() -> None:
    source_sha = _source_sha()
    root = _task_root()
    SMOKE._verify_owner(root, source_sha)
    preflight = SMOKE._require_preflight(source_sha)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("task root is invalid")
    summary = _initial_summary(source_sha)
    summary.update(
        {
            "phase": "prepare",
            "docker_backend_verified": preflight["docker_backend_verified"],
            "docker_isolation_verified": preflight["docker_isolation_verified"],
        }
    )
    stage = "workspace_preflight"
    try:
        _workspace()
        summary["workspace_jest_ready"] = True
        stage = "startup_artifacts_preflight"
        _require_startup_artifacts(root, source_sha)
        summary["startup_artifacts_verified"] = True
        stage = "node_runtime"
        node_version, _ = _node_runtime(root)
        stage = "dependency_download"
        count, total_bytes = _download_private_wheels(root)
        requirements_copy = root / "worker" / "thunderbird-private-caldav-requirements.txt"
        requirements_copy.write_bytes(REQUIREMENTS_PATH.read_bytes())
        os.chmod(requirements_copy, 0o400)
        summary.update(
            {
                "thunderbird_archive_verified": True,
                "marionette_artifacts_verified": True,
                "node_version": node_version,
                "caldav_wheels_verified": True,
                "caldav_wheel_count": count,
                "caldav_wheel_bytes": total_bytes,
            }
        )
    except Exception:
        summary.update(
            {
                "status": "failed",
                "failure_class": {
                    "workspace_preflight": "workspace_preflight_failed",
                    "startup_artifacts_preflight": "startup_artifacts_preflight_failed",
                    "node_runtime": "node_runtime_missing",
                    "dependency_download": "dependency_download_failed",
                }[stage],
            }
        )
        _write_summary(summary)
        raise
    _write_summary(summary)


def _install() -> None:
    source_sha = _source_sha()
    root, summary = _require_prepared(source_sha)
    summary.update({"phase": "dependency_install", "status": "running"})
    _write_summary(summary)
    mounts = [
        (root / "worker", "/input", True),
        (root / "private-caldav-wheels", "/private-wheels", True),
        (root / "venv", "/task/venv", False),
        (root / "workspace", "/task/workspace", False),
    ]
    python_program = r"""
import subprocess
commands = [
  ['/task/venv/bin/python', '-B', '-m', 'pip', 'install', '--isolated', '--no-index',
   '--no-deps', '--no-build-isolation', '--no-cache-dir', '--require-hashes',
   '--only-binary=:all:', '--find-links', '/private-wheels',
   '-r', '/input/thunderbird-private-caldav-requirements.txt'],
  ['/task/venv/bin/python', '-B', '-m', 'pip', 'check'],
]
for command in commands:
    try:
        result = subprocess.run(command, stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                check=False, timeout=120)
    except Exception:
        raise SystemExit(1)
    if result.returncode != 0:
        raise SystemExit(1)
"""
    try:
        code = SMOKE._run_container_bounded(
            "private-install",
            ["/usr/local/bin/python3", "-B", "-c", python_program],
            root=root,
            mounts=mounts,
            log_path=root / "logs" / "private-caldav-install.log",
            timeout=INSTALL_TIMEOUT_SECONDS,
            timeout_phase="dependency_install",
            timeout_class="dependency_error",
            failure_phase="dependency_install",
            failure_class="dependency_error",
        )
        if code != 0:
            raise ValueError("offline test dependency installation failed")
    except Exception:
        summary.update(
            {
                "status": "failed",
                "phase": "dependency_install",
                "failure_class": "dependency_install_failed",
            }
        )
        _write_summary(summary)
        raise
    summary.update(
        {
            "private_dependencies_installed": True,
            "phase": "fixture_run",
        }
    )
    _write_summary(summary)


def _workspace_result_path() -> Path:
    return Path("/task/workspace") / RESULT_FILENAME


def _read_native_result(path: Path) -> dict[str, Any]:
    try:
        metadata = path.lstat()
        if (
            path.is_symlink()
            or not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or metadata.st_size > 2048
        ):
            raise ValueError
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        raise ValueError("native client result is invalid") from None
    if (
        not isinstance(value, dict)
        or set(value) != {"schema", "status", "appVersion", *RESULT_FIELDS}
        or value.get("schema") != RESULT_SCHEMA
        or value.get("status") != "passed"
        or value.get("appVersion") != "158.0.1"
        or any(type(value.get(key)) is not bool or value[key] is not True for key in RESULT_FIELDS)
    ):
        raise ValueError("native client result is invalid")
    return value


def _classify_jest_report(value: Any) -> tuple[str, str]:
    """Project Jest output onto fixed diagnostics without returning its text."""
    if not isinstance(value, dict) or value.get("success") is not False:
        return "unknown", "jest_report_invalid"
    suites = value.get("testResults")
    if not isinstance(suites, list) or len(suites) > 8:
        return "unknown", "jest_report_invalid"

    native_failures: set[tuple[str, str]] = set()
    failed_assertion = False
    suite_error = value.get("testExecError") is not None
    if isinstance(value.get("testExecError"), dict):
        error_message = value["testExecError"].get("message")
        if isinstance(error_message, str):
            error_class = _jest_text_failure_class(error_message)
            if error_class is not None:
                return "suite_load", error_class
    for suite in suites:
        if not isinstance(suite, dict):
            return "unknown", "jest_report_invalid"
        suite_status = suite.get("status")
        if suite.get("testExecError") is not None or suite_status not in {
            "passed",
            "failed",
        }:
            suite_error = True

        assertions = suite.get("assertionResults", suite.get("testResults", []))
        if not isinstance(assertions, list) or len(assertions) > 64:
            return "unknown", "jest_report_invalid"
        if suite_status == "failed" and not assertions:
            suite_error = True
            suite_message = suite.get("message")
            if isinstance(suite_message, str):
                error_class = _jest_text_failure_class(suite_message)
                if error_class is not None:
                    return "suite_load", error_class
        if isinstance(suite.get("testExecError"), dict):
            error_message = suite["testExecError"].get("message")
            if isinstance(error_message, str):
                error_class = _jest_text_failure_class(error_message)
                if error_class is not None:
                    return "suite_load", error_class
        for assertion in assertions:
            if not isinstance(assertion, dict):
                return "unknown", "jest_report_invalid"
            if assertion.get("status") != "failed":
                continue
            failed_assertion = True
            messages = assertion.get("failureMessages", [])
            if not isinstance(messages, list) or len(messages) > 64:
                return "unknown", "jest_report_invalid"
            for message in messages:
                if not isinstance(message, str) or len(message) > 100_000:
                    return "unknown", "jest_report_invalid"
                native_match = NATIVE_FAILURE_MESSAGE.search(message)
                if native_match is not None:
                    pair = (native_match.group(1), native_match.group(2))
                    if pair in NATIVE_FAILURE_PAIRS:
                        native_failures.add(pair)
                    else:
                        return "unknown", "unrecognized_native_failure"
                elif "Native Thunderbird CalDAV contract failed (" in message:
                    return "unknown", "unrecognized_native_failure"
                elif "Native Thunderbird CalDAV result was invalid." in message:
                    return "native_result", "native_result_invalid"
                elif "Python CalDAV contract exited " in message:
                    return "fixture_setup", "caldav_contract_failed"
                elif (
                    "Radicale exited before readiness (" in message
                    or "Radicale readiness exceeded 10 seconds (" in message
                ):
                    return "radicale_start", "radicale_not_ready"
                else:
                    error_class = _jest_text_failure_class(message)
                    if error_class is not None:
                        return "unknown", error_class

    if len(native_failures) == 1:
        return next(iter(native_failures))
    if len(native_failures) > 1:
        return "unknown", "unrecognized_native_failure"
    if suite_error:
        return "suite_load", "jest_suite_failed"
    if failed_assertion:
        return "unknown", "jest_assertion_failed"
    return "unknown", "jest_suite_failed"


def _jest_text_failure_class(message: str) -> str | None:
    if len(message) > 100_000:
        return None
    lowered = message.lower()
    for error_class, markers in JEST_TEXT_FAILURE_MARKERS:
        if any(marker in lowered for marker in markers):
            return error_class
    return None


def _unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON field")
        result[key] = value
    return result


def _read_jest_report(path: Path) -> dict[str, Any]:
    try:
        metadata = path.lstat()
        if (
            path.is_symlink()
            or not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or metadata.st_size <= 0
            or metadata.st_size > MAX_JEST_REPORT_BYTES
        ):
            raise ValueError
        value = json.loads(
            path.read_text(encoding="utf-8"), object_pairs_hook=_unique_json_object
        )
    except (OSError, ValueError, json.JSONDecodeError):
        raise ValueError("Jest report is invalid") from None
    if not isinstance(value, dict):
        raise ValueError("Jest report is invalid")
    return value


def _jest_report_failure_class(path: Path) -> str:
    try:
        metadata = path.lstat()
    except OSError:
        return "jest_report_missing"
    if (
        not path.is_symlink()
        and stat.S_ISREG(metadata.st_mode)
        and metadata.st_uid == os.getuid()
        and stat.S_IMODE(metadata.st_mode) == 0o600
        and metadata.st_size == 0
    ):
        return "jest_report_missing"
    return "jest_report_invalid"


def _write_worker_diagnostic(
    path: Path,
    source_sha: str,
    failure_stage: str,
    failure_class: str,
) -> None:
    if (
        not isinstance(source_sha, str)
        or not re.fullmatch(r"[0-9a-f]{40}", source_sha)
    ):
        raise ValueError("worker source identity is invalid")
    if (
        not isinstance(failure_stage, str)
        or failure_stage not in FIXTURE_FAILURE_STAGES
        or not isinstance(failure_class, str)
        or failure_class not in FIXTURE_FAILURE_CLASSES
    ):
        failure_stage, failure_class = "unknown", "unknown"
    payload = {
        "schema": WORKER_DIAGNOSTIC_SCHEMA,
        "status": "failed",
        "source_sha": source_sha,
        "fixture_failure_stage": failure_stage,
        "fixture_failure_class": failure_class,
    }
    descriptor = os.open(
        path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(payload, output, sort_keys=True, separators=(",", ":"))
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())


def _read_worker_diagnostic(path: Path, source_sha: str) -> dict[str, str] | None:
    try:
        metadata = path.lstat()
        if (
            path.is_symlink()
            or not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or metadata.st_size > 512
        ):
            return None
        value = json.loads(
            path.read_text(encoding="utf-8"), object_pairs_hook=_unique_json_object
        )
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    expected = {
        "schema",
        "status",
        "source_sha",
        "fixture_failure_stage",
        "fixture_failure_class",
    }
    if (
        not isinstance(value, dict)
        or set(value) != expected
        or value.get("schema") != WORKER_DIAGNOSTIC_SCHEMA
        or value.get("status") != "failed"
        or value.get("source_sha") != source_sha
        or not isinstance(value.get("fixture_failure_stage"), str)
        or value.get("fixture_failure_stage") not in FIXTURE_FAILURE_STAGES
        or not isinstance(value.get("fixture_failure_class"), str)
        or value.get("fixture_failure_class") not in FIXTURE_FAILURE_CLASSES
    ):
        return None
    return {
        "fixture_failure_stage": value["fixture_failure_stage"],
        "fixture_failure_class": value["fixture_failure_class"],
    }


def _read_caldav_contract_diagnostic(
    path: Path, source_sha: str
) -> dict[str, str] | None:
    descriptor = -1
    try:
        link_metadata = path.lstat()
        if (
            path.is_symlink()
            or not stat.S_ISREG(link_metadata.st_mode)
        ):
            return None
        descriptor = os.open(
            path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        )
        with os.fdopen(descriptor, "rb") as source:
            descriptor = -1
            metadata = os.fstat(source.fileno())
            if (
                not stat.S_ISREG(metadata.st_mode)
                or metadata.st_uid != os.getuid()
                or stat.S_IMODE(metadata.st_mode) != 0o600
                or metadata.st_size > MAX_CALDAV_CONTRACT_DIAGNOSTIC_BYTES
            ):
                return None
            raw_value = source.read(MAX_CALDAV_CONTRACT_DIAGNOSTIC_BYTES + 1)
        if len(raw_value) > MAX_CALDAV_CONTRACT_DIAGNOSTIC_BYTES:
            return None
        value = json.loads(
            raw_value.decode("utf-8"), object_pairs_hook=_unique_json_object
        )
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
    if (
        not isinstance(value, dict)
        or set(value) != {"schema", "status", "source_sha", "phase", "error_class"}
        or value.get("schema") != CALDAV_CONTRACT_DIAGNOSTIC_SCHEMA
        or value.get("status") != "failed"
        or value.get("source_sha") != source_sha
        or not isinstance(value.get("phase"), str)
        or value.get("phase") not in CALDAV_CONTRACT_PHASES
        or not isinstance(value.get("error_class"), str)
        or value.get("error_class") not in CALDAV_CONTRACT_ERROR_CLASSES
    ):
        return None
    return {
        "fixture_failure_stage": f"python_contract_{value['phase']}",
        "fixture_failure_class": CALDAV_CONTRACT_SUMMARY_CLASSES[
            value["error_class"]
        ],
    }


def _remove_caldav_contract_diagnostic(path: Path) -> None:
    try:
        metadata = path.lstat()
        if (
            not path.is_symlink()
            and stat.S_ISREG(metadata.st_mode)
            and metadata.st_uid == os.getuid()
            and stat.S_IMODE(metadata.st_mode) == 0o600
        ):
            path.unlink()
    except OSError:
        pass


def _project_caldav_contract_diagnostic(
    failure_stage: str,
    failure_class: str,
    diagnostic: dict[str, str] | None,
) -> tuple[str, str]:
    if (
        (failure_stage, failure_class) == ("fixture_setup", "caldav_contract_failed")
        and diagnostic is not None
        and set(diagnostic)
        == {"fixture_failure_stage", "fixture_failure_class"}
        and isinstance(diagnostic["fixture_failure_stage"], str)
        and diagnostic["fixture_failure_stage"] in CALDAV_CONTRACT_SUMMARY_STAGES
        and isinstance(diagnostic["fixture_failure_class"], str)
        and diagnostic["fixture_failure_class"]
        in CALDAV_CONTRACT_SUMMARY_CLASSES.values()
    ):
        return (
            diagnostic["fixture_failure_stage"],
            diagnostic["fixture_failure_class"],
        )
    return failure_stage, failure_class


def _close_worker_failure(
    workspace: Path,
    source_sha: str,
    failure_stage: str,
    failure_class: str,
) -> None:
    diagnostic = workspace / WORKER_DIAGNOSTIC_FILENAME
    caldav_diagnostic = workspace / CALDAV_CONTRACT_DIAGNOSTIC_FILENAME
    report = workspace / JEST_REPORT_FILENAME
    try:
        _write_worker_diagnostic(
            diagnostic, source_sha, failure_stage, failure_class
        )
    finally:
        try:
            report_metadata = report.lstat()
            if (
                stat.S_ISREG(report_metadata.st_mode)
                and report_metadata.st_uid == os.getuid()
                and stat.S_IMODE(report_metadata.st_mode) == 0o600
            ):
                report.unlink()
        except OSError:
            pass
        _remove_caldav_contract_diagnostic(caldav_diagnostic)


def _container_worker() -> int:
    if Path("/task").resolve() != Path("/task"):
        return 2
    node = Path("/task/node/node")
    source = Path("/task/source")
    test_runner = source / "node_modules" / "jest" / "bin" / "jest.js"
    workspace = Path("/task/workspace")
    result_path = _workspace_result_path()
    report_path = workspace / JEST_REPORT_FILENAME
    diagnostic_path = workspace / WORKER_DIAGNOSTIC_FILENAME
    caldav_diagnostic_path = workspace / CALDAV_CONTRACT_DIAGNOSTIC_FILENAME
    source_sha = os.environ.get("MCW_PRIVATE_CALDAV_SOURCE_SHA", "")

    def fail(failure_stage: str, failure_class: str) -> int:
        try:
            _close_worker_failure(
                workspace, source_sha, failure_stage, failure_class
            )
        except Exception:
            pass
        print(json.dumps({"status": "failed", "failure_class": "jest_failed"}))
        return 1

    if (
        result_path.exists()
        or result_path.is_symlink()
        or report_path.exists()
        or report_path.is_symlink()
        or diagnostic_path.exists()
        or diagnostic_path.is_symlink()
        or caldav_diagnostic_path.exists()
        or caldav_diagnostic_path.is_symlink()
    ):
        print(json.dumps({"status": "failed", "failure_class": "input_invalid"}))
        return 1
    if (
        not node.is_file()
        or not os.access(node, os.X_OK)
        or not test_runner.is_file()
    ):
        return fail("jest_runner", "worker_input_invalid")
    log_path = Path("/tmp/thunderbird-private-caldav-jest.log")
    command = [
        str(node),
        str(test_runner),
        "--runInBand",
        "--runTestsByPath",
        "test/integration/PrivateCalendarClientRadicaleContract.test.ts",
        "--cacheDirectory",
        "/tmp/private-caldav-jest-cache",
        "--json",
        "--outputFile",
        str(report_path),
    ]
    failure_stage = "jest_runner"
    failure_class = "jest_process_error"
    try:
        report_descriptor = os.open(
            report_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        os.close(report_descriptor)
        descriptor = os.open(
            log_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        with os.fdopen(descriptor, "wb") as log:
            previous_umask = os.umask(0o077)
            try:
                try:
                    result = subprocess.run(
                        command,
                        cwd=source / "matrix-calendar-server",
                        stdin=subprocess.DEVNULL,
                        stdout=log,
                        stderr=subprocess.STDOUT,
                        check=False,
                        timeout=300,
                    )
                except subprocess.TimeoutExpired:
                    return fail("jest_runner", "jest_timeout")
                except (OSError, subprocess.SubprocessError):
                    return fail("jest_runner", "jest_process_error")
            finally:
                os.umask(previous_umask)
        if result.returncode != 0:
            try:
                failure_stage, failure_class = _classify_jest_report(
                    _read_jest_report(report_path)
                )
            except ValueError:
                failure_stage = "jest_runner"
                failure_class = _jest_report_failure_class(report_path)
            contract_diagnostic = None
            if (failure_stage, failure_class) == (
                "fixture_setup",
                "caldav_contract_failed",
            ):
                contract_diagnostic = _read_caldav_contract_diagnostic(
                    caldav_diagnostic_path, source_sha
                )
            failure_stage, failure_class = _project_caldav_contract_diagnostic(
                failure_stage, failure_class, contract_diagnostic
            )
            return fail(failure_stage, failure_class)
        if caldav_diagnostic_path.exists() or caldav_diagnostic_path.is_symlink():
            return fail("jest_runner", "worker_input_invalid")
        try:
            report_metadata = report_path.lstat()
            if (
                not stat.S_ISREG(report_metadata.st_mode)
                or report_path.is_symlink()
                or report_metadata.st_uid != os.getuid()
                or stat.S_IMODE(report_metadata.st_mode) != 0o600
                or report_metadata.st_size > MAX_JEST_REPORT_BYTES
            ):
                raise ValueError
            report_path.unlink()
        except (OSError, ValueError):
            return fail("jest_runner", "jest_report_invalid")
        failure_stage, failure_class = "native_result", "native_result_invalid"
        value = _read_native_result(result_path)
    except Exception:
        return fail(failure_stage, failure_class)
    safe = {
        "schema": RESULT_SCHEMA,
        "status": "passed",
        "appVersion": value["appVersion"],
        **{key: True for key in sorted(RESULT_FIELDS)},
    }
    print(json.dumps(safe, sort_keys=True, separators=(",", ":")))
    return 0


def _run() -> None:
    source_sha = _source_sha()
    root, summary = _require_prepared(source_sha, installed=True)
    source = _workspace()
    result_path = root / "workspace" / RESULT_FILENAME
    report_path = root / "workspace" / JEST_REPORT_FILENAME
    diagnostic_path = root / "workspace" / WORKER_DIAGNOSTIC_FILENAME
    caldav_diagnostic_path = (
        root / "workspace" / CALDAV_CONTRACT_DIAGNOSTIC_FILENAME
    )
    if any(
        path.exists() or path.is_symlink()
        for path in (result_path, report_path, diagnostic_path, caldav_diagnostic_path)
    ):
        raise ValueError("native result path already exists")
    mounts = [
        (root / "worker", "/input", True),
        (root / "app", "/task/app", True),
        (root / "venv", "/task/venv", True),
        (root / "workspace", "/task/workspace", False),
        (root / "node", "/task/node", True),
        (source, "/task/source", True),
    ]
    extra_environment = {
        "PRIVATE_CALDAV_CONTRACT": "1",
        "MCW_PRIVATE_CALDAV_SOURCE_SHA": source_sha,
        "MCW_PRIVATE_CALDAV_CONTRACT_DIAGNOSTIC_FILE": (
            "/task/workspace/" + CALDAV_CONTRACT_DIAGNOSTIC_FILENAME
        ),
        "MCW_PRIVATE_CALDAV_NATIVE_PROFILE": "1",
        "MCW_PRIVATE_CALDAV_PYTHON": "/task/venv/bin/python",
        "MCW_PRIVATE_CALDAV_SITE_PACKAGES": "/task/venv/lib/python3.13/site-packages",
        "MCW_PRIVATE_CALDAV_RADICALE_PYTHON": "/app/bin/python",
        "MCW_PRIVATE_CALDAV_NATIVE_THUNDERBIRD_BIN": "/task/app/thunderbird/thunderbird",
        "MCW_PRIVATE_CALDAV_NATIVE_WORKSPACE": "/task/workspace",
        "MCW_PRIVATE_CALDAV_RESULT_FILE": "/task/workspace/" + RESULT_FILENAME,
    }
    summary.update({"phase": "fixture_run", "status": "running"})
    _write_summary(summary)
    try:
        stdout = SMOKE._capture_container(
            "private-caldav",
            [
                "/usr/local/bin/python3",
                "-B",
                "/task/source/dev/thunderbird-private-caldav-smoke.py",
                "--container-worker",
            ],
            root=root,
            mounts=mounts,
            timeout=NATIVE_TIMEOUT_SECONDS,
            failure_phase="startup",
            failure_class="marionette_error",
            extra_environment=extra_environment,
        )
        lines = [line for line in stdout.splitlines() if line.startswith("{")]
        if len(lines) != 1:
            summary.update(
                {
                    "fixture_failure_stage": "native_result",
                    "fixture_failure_class": "native_result_invalid",
                }
            )
            raise ValueError("native client output was invalid")
        value = json.loads(lines[0])
        if (
            not isinstance(value, dict)
            or set(value) != {"schema", "status", "appVersion", *RESULT_FIELDS}
            or value.get("schema") != RESULT_SCHEMA
            or value.get("status") != "passed"
            or value.get("appVersion") != "158.0.1"
            or any(value.get(key) is not True for key in RESULT_FIELDS)
        ):
            summary.update(
                {
                    "fixture_failure_stage": "native_result",
                    "fixture_failure_class": "native_result_invalid",
                }
            )
            raise ValueError("native client qualification failed")
        result = _read_native_result(result_path)
    except Exception:
        diagnostic = _read_worker_diagnostic(
            root / "workspace" / WORKER_DIAGNOSTIC_FILENAME, source_sha
        )
        if diagnostic is not None:
            summary.update(diagnostic)
        elif summary.get("fixture_failure_stage") is None:
            summary.update(
                {
                    "fixture_failure_stage": "unknown",
                    "fixture_failure_class": "unknown",
                }
            )
        summary.update(
            {
                "status": "failed",
                "phase": "fixture_run",
                "failure_class": "jest_failed",
            }
        )
        _write_summary(summary)
        raise
    summary.update(
        {
            "phase": "complete",
            "native_provider_passed": True,
            "app_version": result["appVersion"],
            **{key: result[key] for key in RESULT_FIELDS},
        }
    )
    _write_summary(summary)


def _finalize() -> None:
    source_sha = os.environ.get("GITHUB_SHA", "")
    try:
        summary = _load_summary()
    except Exception:
        summary = _initial_summary(source_sha if re.fullmatch(r"[0-9a-f]{40}", source_sha) else "0" * 40)
    if summary.get("status") == "running":
        outcomes = {
            "image": os.environ.get("TB_PRIVATE_IMAGE_OUTCOME", ""),
            "preflight": os.environ.get("TB_PRIVATE_PREFLIGHT_OUTCOME", ""),
            "prepare": os.environ.get("TB_PRIVATE_PREPARE_OUTCOME", ""),
            "install": os.environ.get("TB_PRIVATE_INSTALL_OUTCOME", ""),
            "run": os.environ.get("TB_PRIVATE_RUN_OUTCOME", ""),
        }
        failed = next((key for key, value in outcomes.items() if value != "success"), None)
        failure_classes = {
            "image": "container_backend_unavailable",
            "preflight": "container_isolation_unavailable",
            "prepare": "dependency_download_failed",
            "install": "dependency_install_failed",
            "run": "jest_failed",
        }
        result_passed = (
            summary.get("native_provider_passed") is True
            and summary.get("docker_backend_verified") is True
            and summary.get("docker_isolation_verified") is True
            and summary.get("workspace_jest_ready") is True
            and summary.get("startup_artifacts_verified") is True
            and summary.get("thunderbird_archive_verified") is True
            and summary.get("marionette_artifacts_verified") is True
            and summary.get("caldav_wheels_verified") is True
            and summary.get("caldav_wheel_count") == EXPECTED_WHEEL_COUNT
            and isinstance(summary.get("caldav_wheel_bytes"), int)
            and summary.get("caldav_wheel_bytes", 0) > 0
            and summary.get("private_dependencies_installed") is True
            and summary.get("app_version") == "158.0.1"
            and all(summary.get(key) is True for key in RESULT_FIELDS)
        )
        if failed is not None:
            run_failure = (
                {
                    "fixture_failure_stage": "unknown",
                    "fixture_failure_class": "unknown",
                }
                if failed == "run"
                else {}
            )
            summary.update(
                {
                    "status": "failed",
                    "phase": {
                        "image": "preflight",
                        "preflight": "preflight",
                        "prepare": "prepare",
                        "install": "dependency_install",
                        "run": "fixture_run",
                    }[failed],
                    "failure_class": failure_classes[failed],
                    **run_failure,
                }
            )
        elif result_passed:
            summary.update(
                {"status": "passed", "phase": "complete", "failure_class": None}
            )
        else:
            summary.update(
                {
                    "status": "failed",
                    "phase": "complete",
                    "failure_class": "internal_error",
                }
            )
    root = _task_root()
    if root.exists() or root.is_symlink():
        try:
            SMOKE._cleanup_root(root, source_sha)
        except Exception:
            if summary.get("status") != "failed":
                summary.update(
                    {
                        "status": "failed",
                        "phase": "complete",
                        "failure_class": "cleanup_failed",
                        "fixture_failure_stage": "cleanup",
                        "fixture_failure_class": "cleanup_failed",
                    }
                )
    if summary.get("status") == "running":
        summary.update({"status": "passed", "phase": "complete", "failure_class": None})
    _write_summary(summary)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", nargs="?", choices=("prepare", "install", "run", "finalize"))
    parser.add_argument("--container-worker", action="store_true")
    args = parser.parse_args()
    if args.container_worker:
        return _container_worker()
    if args.mode is None:
        return 2
    try:
        if args.mode == "finalize":
            _finalize()
            return 0
        if args.mode == "prepare":
            _prepare()
        elif args.mode == "install":
            _install()
        else:
            _run()
        return 0
    except Exception:
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
