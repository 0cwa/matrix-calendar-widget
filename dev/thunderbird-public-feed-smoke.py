#!/usr/bin/env python3
"""Run the isolated native Thunderbird public ICS feed qualification profile."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import re
import shutil
import stat
import subprocess
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
SMOKE_PATH = SCRIPT_DIR / "thunderbird-calendar-smoke.py"
SMOKE_SPEC = importlib.util.spec_from_file_location(
    "thunderbird_calendar_smoke", SMOKE_PATH
)
if SMOKE_SPEC is None or SMOKE_SPEC.loader is None:
    raise RuntimeError("Thunderbird startup helper is unavailable")
SMOKE = importlib.util.module_from_spec(SMOKE_SPEC)
SMOKE_SPEC.loader.exec_module(SMOKE)

# Summary @2 adds one closed, privacy-safe subreason for startup artifact preflight.
SUMMARY_SCHEMA = "thunderbird-public-ics-summary@2"
RESULT_SCHEMA = "thunderbird-public-ics-qualification@1"
EXPECTED_APP_VERSION = "158.0.1"
EXPECTED_NODE_PREFIX = (22, 12, 0)
NATIVE_RESULT_FILENAME = "public-feed-native-result.json"
CONTAINER_RESULT_PATH = Path("/task/workspace") / NATIVE_RESULT_FILENAME
JEST_PROCESS_MARGIN_SECONDS = 60
CONTAINER_CLEANUP_MARGIN_SECONDS = 60
# The fixture is allowed 843 seconds, Jest 903, and the Docker invocation 963.
# Keep 60 seconds between each outer deadline for startup and process cleanup.
JEST_TIMEOUT_SECONDS = 903
NATIVE_TIMEOUT_SECONDS = 963

PREDICATE_FIELDS = {
    "calendarTab",
    "providerTypeICS",
    "readOnlyCalendar",
    "storedCredentialsAbsent",
    "initialFeedObserved",
    "canonicalEventObserved",
    "explicitRefreshObserved",
    "revokedRefreshObserved",
    "revokedResponseNotFound",
    "exactGatewayRoute",
    "gatewayAuthorizationAbsent",
}
COUNT_FIELDS = {
    "gatewayGetCount",
    "exactRouteCount",
    "authorizationAbsentCount",
    "http200Count",
    "http404Count",
}
SUMMARY_BOOLEAN_FIELDS = {
    "dockerBackendVerified",
    "dockerIsolationVerified",
    "workspaceJestReady",
    "startupArtifactsVerified",
    "thunderbirdArchiveVerified",
    "marionetteArtifactsVerified",
    "nativeProviderPassed",
    *PREDICATE_FIELDS,
}
FAILURE_STAGES = {
    "input_preflight",
    "profile_setup",
    "application_startup",
    "calendar_tab",
    "provider_setup",
    "initial_refresh",
    "event_observation",
    "explicit_refresh",
    "unpublish",
    "revoked_refresh",
    "cleanup",
    "workspace_preflight",
    "startup_artifacts_preflight",
    "node_runtime",
    "fixture_run",
    "complete",
}
FAILURE_CLASSES = {
    "calendar_not_read_only",
    "calendar_not_registered",
    "calendar_setup_failed",
    "calendar_tab_unavailable",
    "canonical_event_not_observed",
    "cleanup_failed",
    "container_backend_unavailable",
    "container_isolation_unavailable",
    "input_missing",
    "invalid_input",
    "invalid_public_url",
    "internal_error",
    "jest_failed",
    "native_result_invalid",
    "native_timeout",
    "node_runtime_missing",
    "preflight_failed",
    "provider_unavailable",
    "public_route_not_observed",
    "qualification_predicate_failed",
    "refresh_failed",
    "revoked_route_not_observed",
    "startup_artifacts_preflight_failed",
    "startup_failed",
    "stored_credentials_present",
    "trust_setup_failed",
    "unpublish_failed",
    "unexpected_error",
    "version_mismatch",
    "workspace_preflight_failed",
}
STARTUP_ARTIFACT_FAILURES = {
    # Includes producer summary schema/source/owner/mode and content validation.
    "summary_contract_invalid",
    "binary_artifact_invalid",
    "venv_layout_invalid",
    "marionette_module_invalid",
    "container_interpreter_probe_failed",
    "unknown",
}
NATIVE_FAILURE_STAGES = {
    "input_preflight",
    "profile_setup",
    "application_startup",
    "calendar_tab",
    "provider_setup",
    "initial_refresh",
    "event_observation",
    "explicit_refresh",
    "unpublish",
    "revoked_refresh",
    "cleanup",
    "complete",
}
NATIVE_FAILURE_CLASSES = {
    "invalid_input",
    "input_missing",
    "trust_setup_failed",
    "startup_failed",
    "version_mismatch",
    "calendar_tab_unavailable",
    "provider_unavailable",
    "invalid_public_url",
    "calendar_setup_failed",
    "calendar_not_read_only",
    "calendar_not_registered",
    "refresh_failed",
    "stored_credentials_present",
    "public_route_not_observed",
    "canonical_event_not_observed",
    "unpublish_failed",
    "revoked_route_not_observed",
    "cleanup_failed",
    "qualification_predicate_failed",
    "unexpected_error",
}


def _summary_path() -> Path:
    runner_temp = os.environ.get("RUNNER_TEMP", "")
    parent = Path(runner_temp)
    if not parent.is_absolute() or parent.is_symlink() or not parent.is_dir():
        raise ValueError("runner temp is invalid")
    return parent / "thunderbird-public-feed-summary.json"


def _initial_summary(source_sha: str) -> dict[str, Any]:
    return {
        "schema": SUMMARY_SCHEMA,
        "source_sha": source_sha,
        "status": "running",
        "phase": "preflight",
        "failure_stage": None,
        "failure_class": None,
        "startupArtifactsFailure": None,
        "dockerBackendVerified": False,
        "dockerIsolationVerified": False,
        "workspaceJestReady": False,
        "startupArtifactsVerified": False,
        "thunderbirdArchiveVerified": False,
        "marionetteArtifactsVerified": False,
        "nodeVersion": None,
        "appVersion": None,
        "nativeProviderPassed": False,
        "calendarTab": False,
        "providerTypeICS": False,
        "readOnlyCalendar": False,
        "storedCredentialsAbsent": False,
        "initialFeedObserved": False,
        "canonicalEventObserved": False,
        "explicitRefreshObserved": False,
        "revokedRefreshObserved": False,
        "revokedResponseNotFound": False,
        "exactGatewayRoute": False,
        "gatewayAuthorizationAbsent": False,
        "gatewayGetCount": 0,
        "exactRouteCount": 0,
        "authorizationAbsentCount": 0,
        "http200Count": 0,
        "http404Count": 0,
    }


def _supported_node_version(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    match = re.fullmatch(r"22\.([0-9]{1,3})\.([0-9]{1,3})", value)
    return (
        match is not None
        and (
            22,
            int(match.group(1)),
            int(match.group(2)),
        )
        >= EXPECTED_NODE_PREFIX
    )


def _success_gates(value: dict[str, Any]) -> bool:
    counts_are_valid = (
        all(
            type(value.get(key)) is int and 0 <= value[key] <= 100
            for key in COUNT_FIELDS
        )
        and value["gatewayGetCount"] >= 3
        and value["exactRouteCount"] == value["gatewayGetCount"]
        and value["authorizationAbsentCount"] == value["gatewayGetCount"]
        and value["http200Count"] >= 2
        and value["http404Count"] >= 1
        and value["http200Count"] + value["http404Count"] == value["gatewayGetCount"]
    )
    return (
        value.get("status") in {"running", "passed"}
        and value.get("startupArtifactsFailure") is None
        and all(value.get(key) is True for key in SUMMARY_BOOLEAN_FIELDS)
        and value.get("appVersion") == EXPECTED_APP_VERSION
        and _supported_node_version(value.get("nodeVersion"))
        and counts_are_valid
    )


def _write_summary(payload: dict[str, Any]) -> None:
    source_sha = payload.get("source_sha", "")
    if (
        not isinstance(source_sha, str)
        or re.fullmatch(r"[0-9a-f]{40}", source_sha) is None
    ):
        source_sha = "0" * 40
    safe = _initial_summary(source_sha)
    for key in safe:
        if key in payload:
            safe[key] = payload[key]

    invalid = (
        safe["schema"] != SUMMARY_SCHEMA
        or safe["status"] not in {"running", "passed", "failed"}
        or safe["phase"] not in {"preflight", "prepare", "fixture_run", "complete"}
        or safe["failure_stage"] not in (None, *FAILURE_STAGES)
        or safe["failure_class"] not in (None, *FAILURE_CLASSES)
        or safe["startupArtifactsFailure"] not in (None, *STARTUP_ARTIFACT_FAILURES)
        or (safe["startupArtifactsFailure"] is not None and safe["status"] != "failed")
        or any(type(safe[key]) is not bool for key in SUMMARY_BOOLEAN_FIELDS)
        or any(
            type(safe[key]) is not int or not 0 <= safe[key] <= 100
            for key in COUNT_FIELDS
        )
        or (
            safe["nodeVersion"] is not None
            and not _supported_node_version(safe["nodeVersion"])
        )
        or (
            safe["appVersion"] is not None
            and safe["appVersion"] != EXPECTED_APP_VERSION
        )
        or (
            safe["status"] == "failed"
            and (safe["failure_stage"] is None or safe["failure_class"] is None)
        )
        or (
            safe["status"] == "failed"
            and safe["failure_stage"] == "startup_artifacts_preflight"
            and safe["startupArtifactsFailure"] is None
        )
        or (
            safe["status"] == "passed"
            and (
                safe["phase"] != "complete"
                or safe["failure_stage"] is not None
                or safe["failure_class"] is not None
                or not _success_gates(safe)
            )
        )
    )
    if invalid:
        safe = _initial_summary(source_sha)
        safe.update(
            {
                "status": "failed",
                "phase": "complete",
                "failure_stage": "complete",
                "failure_class": "internal_error",
            }
        )

    path = _summary_path()
    temporary = path.with_suffix(".json.tmp")
    try:
        existing = path.lstat()
    except FileNotFoundError:
        existing = None
    if existing is not None and (
        not stat.S_ISREG(existing.st_mode)
        or existing.st_uid != os.getuid()
        or stat.S_IMODE(existing.st_mode) != 0o600
    ):
        raise ValueError("public feed summary destination is invalid")
    descriptor = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(json.dumps(safe, sort_keys=True, separators=(",", ":")) + "\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    os.chmod(path, 0o600)


def _load_summary() -> dict[str, Any]:
    path = _summary_path()
    try:
        metadata = path.lstat()
        if (
            path.is_symlink()
            or not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or metadata.st_size > 4096
        ):
            raise ValueError
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        raise ValueError("public feed summary is invalid") from None
    if (
        not isinstance(value, dict)
        or set(value) != set(_initial_summary("0" * 40))
        or value.get("startupArtifactsFailure")
        not in (None, *STARTUP_ARTIFACT_FAILURES)
    ):
        raise ValueError("public feed summary is invalid")
    return value


def _source_sha() -> str:
    source_sha = os.environ.get("GITHUB_SHA", "")
    if re.fullmatch(r"[0-9a-f]{40}", source_sha) is None:
        raise ValueError("source identity is invalid")
    return source_sha


def _task_root() -> Path:
    return SMOKE._root_path()


class StartupArtifactsPreflightFailure(Exception):
    """Closed reason for a public startup artifact validation boundary."""

    def __init__(self, reason: str) -> None:
        self.reason = (
            reason
            if isinstance(reason, str) and reason in STARTUP_ARTIFACT_FAILURES
            else "unknown"
        )


def _workspace() -> Path:
    raw = os.environ.get("GITHUB_WORKSPACE", "")
    workspace = Path(raw)
    if (
        not workspace.is_absolute()
        or workspace.is_symlink()
        or not workspace.is_dir()
        or not (workspace / "package.json").is_file()
        or not (workspace / "node_modules" / "jest" / "bin" / "jest.js").is_file()
        or not (
            workspace
            / "matrix-calendar-server"
            / "test"
            / "integration"
            / "PrivateCalendarClientRadicaleContract.test.ts"
        ).is_file()
        or not (workspace / "dev" / "thunderbird-public-feed-smoke.py").is_file()
    ):
        raise ValueError("workspace dependencies are unavailable")
    return workspace.resolve(strict=True)


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
    virtualenv = root / "venv"
    binary_directory = virtualenv / "bin"
    interpreter = binary_directory / "python"
    try:
        virtualenv_metadata = virtualenv.lstat()
        binary_directory_metadata = binary_directory.lstat()
        interpreter_metadata = interpreter.lstat()
    except OSError:
        return False
    return (
        stat.S_ISDIR(virtualenv_metadata.st_mode)
        and virtualenv_metadata.st_uid == os.getuid()
        and stat.S_ISDIR(binary_directory_metadata.st_mode)
        and binary_directory_metadata.st_uid == os.getuid()
        and stat.S_ISLNK(interpreter_metadata.st_mode)
        and interpreter_metadata.st_uid == os.getuid()
    )


def _require_startup_artifacts(root: Path, source_sha: str) -> None:
    try:
        summary_path = SMOKE._summary_path()
        metadata = summary_path.lstat()
        if (
            summary_path.is_symlink()
            or not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
        ):
            raise ValueError
        startup_summary = json.loads(summary_path.read_text(encoding="utf-8"))
    except (SMOKE.SmokeFailure, OSError, ValueError, json.JSONDecodeError):
        raise StartupArtifactsPreflightFailure("summary_contract_invalid") from None

    binary = root / "app" / "thunderbird" / "thunderbird"
    marionette = (
        root
        / "venv"
        / "lib"
        / "python3.13"
        / "site-packages"
        / "marionette_driver"
        / "marionette.py"
    )
    if not _startup_artifacts_verified(startup_summary, source_sha):
        raise StartupArtifactsPreflightFailure("summary_contract_invalid")
    if not _owned_regular_file(binary):
        raise StartupArtifactsPreflightFailure("binary_artifact_invalid")
    if not _owned_venv_python_link(root):
        raise StartupArtifactsPreflightFailure("venv_layout_invalid")
    if not _owned_regular_file(marionette):
        raise StartupArtifactsPreflightFailure("marionette_module_invalid")

    try:
        SMOKE._capture_container(
            "verify-public-venv",
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
    except Exception:
        raise StartupArtifactsPreflightFailure(
            "container_interpreter_probe_failed"
        ) from None


def _node_runtime(root: Path) -> tuple[str, Path]:
    if platform.machine() not in {"x86_64", "AMD64"}:
        raise ValueError("Node runtime architecture is unsupported")
    node = shutil.which("node")
    tool_cache = os.environ.get("RUNNER_TOOL_CACHE", "")
    if not node or not tool_cache:
        raise ValueError("setup-node runtime is unavailable")
    source = Path(node).resolve(strict=True)
    cache_root = Path(tool_cache).resolve(strict=True) / "node"
    try:
        source.relative_to(cache_root)
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
    if probe.returncode != 0 or match is None:
        raise ValueError("Node runtime version is unsupported")
    version = tuple(int(part) for part in match.groups())
    if version < EXPECTED_NODE_PREFIX:
        raise ValueError("Node runtime is below the workspace engine floor")
    destination_directory = root / "node"
    if destination_directory.exists() or destination_directory.is_symlink():
        raise ValueError("Node staging path already exists")
    destination_directory.mkdir(mode=0o700)
    destination = destination_directory / "node"
    shutil.copyfile(source, destination)
    os.chmod(destination, 0o500)
    return ".".join(str(part) for part in version), destination_directory


def _prepared(source_sha: str) -> tuple[Path, dict[str, Any], Path]:
    root = _task_root()
    SMOKE._verify_owner(root, source_sha)
    summary = _load_summary()
    workspace = _workspace()
    if (
        summary.get("source_sha") != source_sha
        or summary.get("status") != "running"
        or summary.get("dockerBackendVerified") is not True
        or summary.get("dockerIsolationVerified") is not True
        or summary.get("workspaceJestReady") is not True
        or summary.get("startupArtifactsVerified") is not True
        or summary.get("thunderbirdArchiveVerified") is not True
        or summary.get("marionetteArtifactsVerified") is not True
        or not _supported_node_version(summary.get("nodeVersion"))
        or not _owned_regular_file(root / "node" / "node")
        or not os.access(root / "node" / "node", os.X_OK)
        or summary.get("phase") not in {"prepare", "fixture_run"}
    ):
        raise ValueError("public native preparation is incomplete")
    return root, summary, workspace


def _prepare() -> bool:
    source_sha = _source_sha()
    summary = _initial_summary(source_sha)
    summary["phase"] = "prepare"
    _write_summary(summary)
    root = _task_root()
    stage = "workspace_preflight"
    try:
        preflight = SMOKE._require_preflight(source_sha)
        SMOKE._verify_owner(root, source_sha)
        summary["dockerBackendVerified"] = preflight["docker_backend_verified"] is True
        summary["dockerIsolationVerified"] = (
            preflight["docker_isolation_verified"] is True
        )

        _workspace()
        summary["workspaceJestReady"] = True
        stage = "startup_artifacts_preflight"
        _require_startup_artifacts(root, source_sha)
        summary["startupArtifactsVerified"] = True
        startup_summary = json.loads(SMOKE._summary_path().read_text(encoding="utf-8"))
        summary["thunderbirdArchiveVerified"] = (
            startup_summary["archive_sha256_verified"] is True
        )
        summary["marionetteArtifactsVerified"] = (
            startup_summary["python_artifacts_verified"] is True
        )

        stage = "node_runtime"
        node_version, _ = _node_runtime(root)
        summary["nodeVersion"] = node_version
    except StartupArtifactsPreflightFailure as error:
        summary.update(
            {
                "startupArtifactsFailure": error.reason,
                "status": "failed",
                "phase": "prepare",
                "failure_stage": stage,
                "failure_class": "startup_artifacts_preflight_failed",
            }
        )
    except SMOKE.SmokeFailure as error:
        if stage == "startup_artifacts_preflight":
            summary["startupArtifactsFailure"] = "unknown"
        failure_class = {
            "container_backend_unavailable": "container_backend_unavailable",
            "container_isolation_unavailable": "container_isolation_unavailable",
        }.get(error.error_class, "preflight_failed")
        summary.update(
            {
                "status": "failed",
                "phase": "prepare",
                "failure_stage": stage,
                "failure_class": failure_class,
            }
        )
    except Exception:
        if stage == "startup_artifacts_preflight":
            summary["startupArtifactsFailure"] = "unknown"
        failure_class = {
            "workspace_preflight": "workspace_preflight_failed",
            "startup_artifacts_preflight": "startup_artifacts_preflight_failed",
            "node_runtime": "node_runtime_missing",
        }[stage]
        summary.update(
            {
                "status": "failed",
                "phase": "prepare",
                "failure_stage": stage,
                "failure_class": failure_class,
            }
        )
    _write_summary(summary)
    return summary["status"] == "running"


def _valid_native_result(value: Any, *, allow_failed: bool = False) -> bool:
    if not isinstance(value, dict) or value.get("schema") != RESULT_SCHEMA:
        return False
    if value.get("status") == "failed" and allow_failed:
        return (
            set(value) == {"schema", "status", "failure_stage", "failure_class"}
            and value.get("failure_stage") in NATIVE_FAILURE_STAGES
            and value.get("failure_class") in NATIVE_FAILURE_CLASSES
        )
    expected_fields = {
        "schema",
        "status",
        "appVersion",
        *PREDICATE_FIELDS,
        *COUNT_FIELDS,
    }
    if (
        set(value) != expected_fields
        or value.get("status") != "passed"
        or value.get("appVersion") != EXPECTED_APP_VERSION
        or any(
            type(value.get(key)) is not bool or value[key] is not True
            for key in PREDICATE_FIELDS
        )
        or any(
            type(value.get(key)) is not int or not 0 <= value[key] <= 100
            for key in COUNT_FIELDS
        )
    ):
        return False
    return _success_gates(
        {
            "status": "passed",
            "nodeVersion": "22.12.0",
            "appVersion": value["appVersion"],
            "dockerBackendVerified": True,
            "dockerIsolationVerified": True,
            "workspaceJestReady": True,
            "startupArtifactsVerified": True,
            "thunderbirdArchiveVerified": True,
            "marionetteArtifactsVerified": True,
            "nativeProviderPassed": True,
            **{key: value[key] for key in PREDICATE_FIELDS | COUNT_FIELDS},
        }
    )


def _read_native_result(path: Path, *, allow_failed: bool = False) -> dict[str, Any]:
    try:
        metadata = path.lstat()
        if (
            path.is_symlink()
            or not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or metadata.st_size > 4096
        ):
            raise ValueError
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        raise ValueError("native public-feed result is invalid") from None
    if not _valid_native_result(value, allow_failed=allow_failed):
        raise ValueError("native public-feed result is invalid")
    return value


def _public_container_environment() -> dict[str, str]:
    return {
        "MCW_PUBLIC_FEED_NATIVE_PROFILE": "1",
        "MCW_PUBLIC_ICS_PYTHON": "/task/venv/bin/python",
        "MCW_PUBLIC_ICS_SITE_PACKAGES": "/task/venv/lib/python3.13/site-packages",
        "MCW_PUBLIC_ICS_RADICALE_PYTHON": "/app/bin/python",
        "MCW_PUBLIC_ICS_NATIVE_THUNDERBIRD_BIN": "/task/app/thunderbird/thunderbird",
        "MCW_PUBLIC_ICS_NATIVE_WORKSPACE": "/task/workspace",
        "MCW_PUBLIC_ICS_RESULT_FILE": str(CONTAINER_RESULT_PATH),
    }


def _public_container_environment_matches(environment: dict[str, str]) -> bool:
    expected = _public_container_environment()
    public_ics_keys = {key for key in environment if key.startswith("MCW_PUBLIC_ICS_")}
    expected_public_ics_keys = {
        key for key in expected if key.startswith("MCW_PUBLIC_ICS_")
    }
    return (
        environment.get("MCW_PUBLIC_FEED_NATIVE_PROFILE") == "1"
        and "PRIVATE_CALDAV_CONTRACT" not in environment
        and not any(key.startswith("MCW_PRIVATE_") for key in environment)
        and public_ics_keys == expected_public_ics_keys
        and all(environment.get(key) == value for key, value in expected.items())
    )


def _container_worker() -> int:
    if Path("/task").resolve() != Path("/task"):
        return 1
    if not _public_container_environment_matches(dict(os.environ)):
        return 1

    source = Path("/task/source")
    node = Path("/task/node/node")
    test_runner = source / "node_modules" / "jest" / "bin" / "jest.js"
    test_path = (
        source
        / "matrix-calendar-server"
        / "test"
        / "integration"
        / "PrivateCalendarClientRadicaleContract.test.ts"
    )
    if (
        not node.is_file()
        or not os.access(node, os.X_OK)
        or not test_runner.is_file()
        or not test_path.is_file()
        or CONTAINER_RESULT_PATH.exists()
        or CONTAINER_RESULT_PATH.is_symlink()
    ):
        return 1

    log_path = Path("/tmp/thunderbird-public-feed-jest.log")
    try:
        descriptor = os.open(
            log_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        with os.fdopen(descriptor, "wb") as log:
            result = subprocess.run(
                [
                    str(node),
                    str(test_runner),
                    "--runInBand",
                    "--runTestsByPath",
                    str(test_path.relative_to(source / "matrix-calendar-server")),
                    "--cacheDirectory",
                    "/tmp/public-feed-jest-cache",
                ],
                cwd=source / "matrix-calendar-server",
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                check=False,
                timeout=JEST_TIMEOUT_SECONDS,
            )
    except (OSError, subprocess.SubprocessError):
        return 1
    if result.returncode != 0:
        return 1
    try:
        native_result = _read_native_result(CONTAINER_RESULT_PATH)
    except ValueError:
        return 1
    return 0 if native_result.get("status") == "passed" else 1


def _run() -> bool:
    try:
        source_sha = _source_sha()
        root, summary, workspace = _prepared(source_sha)
        host_result_path = root / "workspace" / NATIVE_RESULT_FILENAME
        if host_result_path.exists() or host_result_path.is_symlink():
            raise ValueError("native result already exists")
        mounts = [
            (root / "app", "/task/app", True),
            (root / "venv", "/task/venv", True),
            (root / "workspace", "/task/workspace", False),
            (root / "node", "/task/node", True),
            (workspace, "/task/source", True),
        ]
        summary.update({"phase": "fixture_run", "status": "running"})
        _write_summary(summary)
        exit_code = SMOKE._run_container_bounded(
            "public-feed",
            [
                "/usr/local/bin/python3",
                "-B",
                "/task/source/dev/thunderbird-public-feed-smoke.py",
                "--container-worker",
            ],
            root=root,
            mounts=mounts,
            log_path=root / "logs" / "public-feed-jest.log",
            timeout=NATIVE_TIMEOUT_SECONDS,
            timeout_phase="fixture_run",
            timeout_class="native_timeout",
            failure_phase="fixture_run",
            failure_class="jest_failed",
            extra_environment=_public_container_environment(),
        )
        if exit_code != 0:
            try:
                native_result = _read_native_result(host_result_path, allow_failed=True)
            except ValueError:
                native_result = None
            if native_result is not None and native_result.get("status") == "failed":
                summary.update(
                    {
                        "status": "failed",
                        "failure_stage": native_result["failure_stage"],
                        "failure_class": native_result["failure_class"],
                    }
                )
            else:
                summary.update(
                    {
                        "status": "failed",
                        "failure_stage": "fixture_run",
                        "failure_class": "jest_failed",
                    }
                )
            _write_summary(summary)
            return False

        native_result = _read_native_result(host_result_path)
        summary.update(
            {
                "phase": "complete",
                "nativeProviderPassed": True,
                "appVersion": native_result["appVersion"],
                **{key: native_result[key] for key in PREDICATE_FIELDS | COUNT_FIELDS},
            }
        )
        _write_summary(summary)
        return summary["status"] == "running"
    except SMOKE.SmokeFailure as error:
        failure_class = {
            "container_backend_unavailable": "container_backend_unavailable",
            "container_isolation_unavailable": "container_isolation_unavailable",
            "native_timeout": "native_timeout",
        }.get(error.error_class, "jest_failed")
        _fail_summary("fixture_run", failure_class)
        return False
    except Exception:
        _fail_summary("fixture_run", "native_result_invalid")
        return False


def _fail_summary(stage: str, error_class: str) -> None:
    try:
        summary = _load_summary()
    except Exception:
        source_sha = os.environ.get("GITHUB_SHA", "")
        summary = _initial_summary(
            source_sha if re.fullmatch(r"[0-9a-f]{40}", source_sha) else "0" * 40
        )
    summary.update(
        {
            "status": "failed",
            "phase": "fixture_run" if stage == "fixture_run" else "complete",
            "failure_stage": stage if stage in FAILURE_STAGES else "complete",
            "failure_class": error_class
            if error_class in FAILURE_CLASSES
            else "internal_error",
        }
    )
    try:
        _write_summary(summary)
    except Exception:
        pass


def _outcomes() -> dict[str, str]:
    return {
        "image": os.environ.get("TB_PUBLIC_IMAGE_OUTCOME", ""),
        "workspace": os.environ.get("TB_PUBLIC_WORKSPACE_OUTCOME", ""),
        "preflight": os.environ.get("TB_PUBLIC_PREFLIGHT_OUTCOME", ""),
        "startup_prepare": os.environ.get("TB_PUBLIC_STARTUP_PREPARE_OUTCOME", ""),
        "profile_prepare": os.environ.get("TB_PUBLIC_PROFILE_PREPARE_OUTCOME", ""),
        "run": os.environ.get("TB_PUBLIC_RUN_OUTCOME", ""),
    }


def _finalize() -> bool:
    source_sha = os.environ.get("GITHUB_SHA", "")
    try:
        summary = _load_summary()
    except Exception:
        summary = _initial_summary(
            source_sha if re.fullmatch(r"[0-9a-f]{40}", source_sha) else "0" * 40
        )

    if summary["status"] == "running":
        outcomes = _outcomes()
        failed_step = next(
            (name for name, outcome in outcomes.items() if outcome != "success"),
            None,
        )
        if failed_step is not None:
            failure_data = {
                "image": ("preflight", "container_backend_unavailable"),
                "workspace": ("workspace_preflight", "workspace_preflight_failed"),
                "preflight": ("preflight", "container_isolation_unavailable"),
                "startup_prepare": (
                    "startup_artifacts_preflight",
                    "startup_artifacts_preflight_failed",
                ),
                "profile_prepare": ("node_runtime", "preflight_failed"),
                "run": ("fixture_run", "jest_failed"),
            }[failed_step]
            summary.update(
                {
                    "status": "failed",
                    "phase": "complete",
                    "failure_stage": failure_data[0],
                    "failure_class": failure_data[1],
                }
            )
            if (
                failed_step == "startup_prepare"
                and summary["startupArtifactsFailure"] is None
            ):
                summary["startupArtifactsFailure"] = "unknown"
        elif _success_gates({**summary, "status": "passed"}):
            summary.update(
                {
                    "status": "passed",
                    "phase": "complete",
                    "failure_stage": None,
                    "failure_class": None,
                }
            )
        else:
            summary.update(
                {
                    "status": "failed",
                    "phase": "complete",
                    "failure_stage": "complete",
                    "failure_class": "internal_error",
                }
            )

    try:
        root = _task_root()
        if root.exists() or root.is_symlink():
            SMOKE._cleanup_root(root, summary["source_sha"])
        elif summary["status"] == "passed":
            summary.update(
                {
                    "status": "failed",
                    "phase": "complete",
                    "failure_stage": "complete",
                    "failure_class": "cleanup_failed",
                }
            )
    except Exception:
        summary.update(
            {
                "status": "failed",
                "phase": "complete",
                "failure_stage": "complete",
                "failure_class": "cleanup_failed",
            }
        )

    try:
        _write_summary(summary)
    except Exception:
        return False
    return summary.get("status") == "passed"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", nargs="?", choices=("prepare", "run", "finalize"))
    parser.add_argument("--container-worker", action="store_true")
    args = parser.parse_args()
    if args.container_worker:
        return _container_worker()
    if args.mode == "finalize":
        return 0 if _finalize() else 1
    if args.mode == "prepare":
        return 0 if _prepare() else 1
    if args.mode == "run":
        return 0 if _run() else 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
