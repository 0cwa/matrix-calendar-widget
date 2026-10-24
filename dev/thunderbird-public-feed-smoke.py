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
JEST_REPORT_SPEC = importlib.util.spec_from_file_location(
    "thunderbird_jest_report", SCRIPT_DIR / "thunderbird_jest_report.py"
)
if JEST_REPORT_SPEC is None or JEST_REPORT_SPEC.loader is None:
    raise RuntimeError("Jest report reader is unavailable")
JEST_REPORT = importlib.util.module_from_spec(JEST_REPORT_SPEC)
JEST_REPORT_SPEC.loader.exec_module(JEST_REPORT)

# Summary @3 adds closed, source-bound fixture failure projection fields.
SUMMARY_SCHEMA = "thunderbird-public-ics-summary@3"
RESULT_SCHEMA = "thunderbird-public-ics-qualification@1"
FIXTURE_DIAGNOSTIC_SCHEMA = "thunderbird-public-feed-jest-diagnostic@1"
EXPECTED_APP_VERSION = "158.0.1"
EXPECTED_NODE_PREFIX = (22, 12, 0)
NATIVE_RESULT_FILENAME = "public-feed-native-result.json"
JEST_REPORT_FILENAME = "public-feed-jest-report.json"
FIXTURE_DIAGNOSTIC_FILENAME = "public-feed-jest-diagnostic.json"
CONTAINER_RESULT_PATH = Path("/task/workspace") / NATIVE_RESULT_FILENAME
CONTAINER_JEST_REPORT_PATH = Path("/task/workspace") / JEST_REPORT_FILENAME
CONTAINER_FIXTURE_DIAGNOSTIC_PATH = (
    Path("/task/workspace") / FIXTURE_DIAGNOSTIC_FILENAME
)
MAX_JEST_REPORT_BYTES = 1_000_000
MAX_FIXTURE_DIAGNOSTIC_BYTES = 512
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
FIXTURE_FAILURE_STAGES = {"fixture_run", "jest_runner", "native_result", "suite_load"}
FIXTURE_FAILURE_CLASSES = {
    "jest_assertion_failed",
    "jest_process_error",
    "jest_report_invalid",
    "jest_report_missing",
    "jest_suite_failed",
    "jest_timeout",
    "native_result_invalid",
    "worker_input_invalid",
}
KNOWN_FIXTURE_FRAME = re.compile(
    r"(?m)^\s*at [^\r\n]*\((?:[^\r\n]*[\\/])?"
    r"matrix-calendar-server[\\/]test[\\/]integration[\\/]"
    r"PrivateCalendarClientRadicaleContract\.test\.ts:"
    r"(?P<line>[1-9][0-9]{0,5}):(?P<column>[1-9][0-9]{0,5})\)\s*$"
)
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
        "fixtureFailureStage": None,
        "fixtureFailureClass": None,
        "fixtureFailureLine": None,
        "fixtureFailureColumn": None,
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
        and all(
            value.get(key) is None
            for key in (
                "fixtureFailureStage",
                "fixtureFailureClass",
                "fixtureFailureLine",
                "fixtureFailureColumn",
            )
        )
        and all(value.get(key) is True for key in SUMMARY_BOOLEAN_FIELDS)
        and value.get("appVersion") == EXPECTED_APP_VERSION
        and _supported_node_version(value.get("nodeVersion"))
        and counts_are_valid
    )


def _fixture_failure_values_valid(
    stage: Any, error_class: Any, line: Any, column: Any
) -> bool:
    if stage is None and error_class is None:
        return line is None and column is None
    if (
        not isinstance(stage, str)
        or stage not in FIXTURE_FAILURE_STAGES
        or not isinstance(error_class, str)
        or error_class not in FIXTURE_FAILURE_CLASSES
    ):
        return False
    expected_classes = {
        "fixture_run": {"jest_assertion_failed"},
        "suite_load": {"jest_suite_failed"},
        "native_result": {"native_result_invalid"},
        "jest_runner": {
            "jest_process_error",
            "jest_report_invalid",
            "jest_report_missing",
            "jest_timeout",
            "worker_input_invalid",
        },
    }
    if error_class not in expected_classes[stage]:
        return False
    if line is None and column is None:
        return True
    return (
        stage in {"fixture_run", "suite_load"}
        and type(line) is int
        and 1 <= line <= 999_999
        and type(column) is int
        and 1 <= column <= 999_999
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
        or not _fixture_failure_values_valid(
            safe["fixtureFailureStage"],
            safe["fixtureFailureClass"],
            safe["fixtureFailureLine"],
            safe["fixtureFailureColumn"],
        )
        or (safe["fixtureFailureStage"] is not None and safe["status"] != "failed")
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
        or not _fixture_failure_values_valid(
            value.get("fixtureFailureStage"),
            value.get("fixtureFailureClass"),
            value.get("fixtureFailureLine"),
            value.get("fixtureFailureColumn"),
        )
        or (
            value.get("fixtureFailureStage") is not None
            and value.get("status") != "failed"
        )
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
            "verify-pub-venv",
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


def _classify_public_jest_report(
    value: Any,
) -> tuple[str, str, int | None, int | None] | None:
    if not isinstance(value, dict) or type(value.get("success")) is not bool:
        return "jest_runner", "jest_report_invalid", None, None
    suites = value.get("testResults")
    if not isinstance(suites, list) or not suites or len(suites) > 8:
        return "jest_runner", "jest_report_invalid", None, None

    messages: list[str] = []
    failed_assertion = False
    suite_error = value.get("testExecError") is not None
    top_level_error = value.get("testExecError")
    if isinstance(top_level_error, dict):
        for key in ("message", "stack"):
            message = top_level_error.get(key)
            if isinstance(message, str):
                if len(message) > 100_000:
                    return "jest_runner", "jest_report_invalid", None, None
                messages.append(message)

    for suite in suites:
        if not isinstance(suite, dict):
            return "jest_runner", "jest_report_invalid", None, None
        suite_status = suite.get("status")
        suite_error = (
            suite_error
            or suite.get("testExecError") is not None
            or suite_status == "failed"
        )
        if suite_status not in {"passed", "failed"}:
            suite_error = True
        if suite_status == "failed" and not suite.get(
            "assertionResults", suite.get("testResults", [])
        ):
            suite_error = True

        suite_message = suite.get("message")
        if isinstance(suite_message, str):
            if len(suite_message) > 100_000:
                return "jest_runner", "jest_report_invalid", None, None
            messages.append(suite_message)
        suite_exec_error = suite.get("testExecError")
        if isinstance(suite_exec_error, dict):
            for key in ("message", "stack"):
                message = suite_exec_error.get(key)
                if isinstance(message, str):
                    if len(message) > 100_000:
                        return "jest_runner", "jest_report_invalid", None, None
                    messages.append(message)

        assertions = suite.get("assertionResults", suite.get("testResults", []))
        if not isinstance(assertions, list) or len(assertions) > 64:
            return "jest_runner", "jest_report_invalid", None, None
        for assertion in assertions:
            if not isinstance(assertion, dict):
                return "jest_runner", "jest_report_invalid", None, None
            if assertion.get("status") != "failed":
                continue
            failed_assertion = True
            failure_messages = assertion.get("failureMessages", [])
            if not isinstance(failure_messages, list) or len(failure_messages) > 64:
                return "jest_runner", "jest_report_invalid", None, None
            for message in failure_messages:
                if not isinstance(message, str) or len(message) > 100_000:
                    return "jest_runner", "jest_report_invalid", None, None
                messages.append(message)

    if value["success"] and (failed_assertion or suite_error):
        return "jest_runner", "jest_report_invalid", None, None
    if value["success"]:
        return None
    locations = {
        (int(match.group("line")), int(match.group("column")))
        for message in messages
        for match in KNOWN_FIXTURE_FRAME.finditer(message)
    }
    line, column = next(iter(locations)) if len(locations) == 1 else (None, None)
    if failed_assertion:
        return "fixture_run", "jest_assertion_failed", line, column
    if suite_error:
        return "suite_load", "jest_suite_failed", line, column
    return "jest_runner", "jest_report_invalid", None, None


def _jest_report_failure(path: Path) -> tuple[str, str, int | None, int | None]:
    try:
        report = JEST_REPORT.read_owned_json_object(
            path, max_bytes=MAX_JEST_REPORT_BYTES
        )
    except ValueError:
        try:
            metadata = path.lstat()
        except OSError:
            return "jest_runner", "jest_report_missing", None, None
        if (
            not path.is_symlink()
            and stat.S_ISREG(metadata.st_mode)
            and metadata.st_uid == os.getuid()
            and stat.S_IMODE(metadata.st_mode) == 0o600
            and metadata.st_size == 0
        ):
            return "jest_runner", "jest_report_missing", None, None
        return "jest_runner", "jest_report_invalid", None, None
    failure = _classify_public_jest_report(report)
    return failure or ("jest_runner", "jest_report_invalid", None, None)


def _write_fixture_diagnostic(
    path: Path,
    source_sha: str,
    stage: str,
    error_class: str,
    line: int | None = None,
    column: int | None = None,
) -> None:
    if (
        not isinstance(source_sha, str)
        or re.fullmatch(r"[0-9a-f]{40}", source_sha) is None
        or not _fixture_failure_values_valid(stage, error_class, line, column)
    ):
        raise ValueError("public Jest diagnostic is invalid")
    payload = {
        "schema": FIXTURE_DIAGNOSTIC_SCHEMA,
        "status": "failed",
        "source_sha": source_sha,
        "fixtureFailureStage": stage,
        "fixtureFailureClass": error_class,
        "fixtureFailureLine": line,
        "fixtureFailureColumn": column,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n"
    if len(encoded.encode("utf-8")) > MAX_FIXTURE_DIAGNOSTIC_BYTES:
        raise ValueError("public Jest diagnostic is invalid")
    descriptor = os.open(
        path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(encoded)
        output.flush()
        os.fsync(output.fileno())


def _read_fixture_diagnostic(path: Path, source_sha: str) -> dict[str, Any] | None:
    if re.fullmatch(r"[0-9a-f]{40}", source_sha) is None:
        return None
    try:
        value = JEST_REPORT.read_owned_json_object(
            path, max_bytes=MAX_FIXTURE_DIAGNOSTIC_BYTES
        )
    except ValueError:
        return None
    expected = {
        "schema",
        "status",
        "source_sha",
        "fixtureFailureStage",
        "fixtureFailureClass",
        "fixtureFailureLine",
        "fixtureFailureColumn",
    }
    if (
        not isinstance(value, dict)
        or set(value) != expected
        or value.get("schema") != FIXTURE_DIAGNOSTIC_SCHEMA
        or value.get("status") != "failed"
        or value.get("source_sha") != source_sha
        or not _fixture_failure_values_valid(
            value.get("fixtureFailureStage"),
            value.get("fixtureFailureClass"),
            value.get("fixtureFailureLine"),
            value.get("fixtureFailureColumn"),
        )
    ):
        return None
    return {
        key: value[key]
        for key in (
            "fixtureFailureStage",
            "fixtureFailureClass",
            "fixtureFailureLine",
            "fixtureFailureColumn",
        )
    }


def _remove_jest_report(path: Path) -> bool:
    try:
        path.unlink()
    except FileNotFoundError:
        return True
    except OSError:
        return False
    return True


def _invoke_public_jest(
    *,
    node: Path,
    test_runner: Path,
    test_path: Path,
    working_directory: Path,
    report_path: Path,
    log_path: Path,
    cache_directory: str,
    timeout: int,
) -> tuple[int, tuple[str, str, int | None, int | None] | None]:
    if report_path.exists() or report_path.is_symlink():
        return 1, ("jest_runner", "jest_report_invalid", None, None)
    command = [
        str(node),
        str(test_runner),
        "--runInBand",
        "--runTestsByPath",
        str(test_path.relative_to(working_directory)),
        "--cacheDirectory",
        cache_directory,
        "--json",
        "--outputFile",
        str(report_path),
    ]
    report_created = False
    result_code = 1
    failure: tuple[str, str, int | None, int | None] | None = None
    try:
        descriptor = os.open(
            report_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        report_created = True
        os.close(descriptor)
        log_descriptor = os.open(
            log_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        with os.fdopen(log_descriptor, "wb") as log:
            previous_umask = os.umask(0o077)
            try:
                result = subprocess.run(
                    command,
                    cwd=working_directory,
                    stdin=subprocess.DEVNULL,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    check=False,
                    timeout=timeout,
                )
            finally:
                os.umask(previous_umask)
        result_code = result.returncode
        if result_code != 0:
            failure = _jest_report_failure(report_path)
    except subprocess.TimeoutExpired:
        failure = ("jest_runner", "jest_timeout", None, None)
    except (OSError, subprocess.SubprocessError):
        failure = ("jest_runner", "jest_process_error", None, None)
    finally:
        if report_created and not _remove_jest_report(report_path):
            failure = ("jest_runner", "jest_report_invalid", None, None)
    return result_code, failure


def _public_container_environment(source_sha: str) -> dict[str, str]:
    if re.fullmatch(r"[0-9a-f]{40}", source_sha) is None:
        raise ValueError("source identity is invalid")
    return {
        "MCW_PUBLIC_FEED_NATIVE_PROFILE": "1",
        "MCW_PUBLIC_ICS_SOURCE_SHA": source_sha,
        "MCW_PUBLIC_ICS_PYTHON": "/task/venv/bin/python",
        "MCW_PUBLIC_ICS_SITE_PACKAGES": "/task/venv/lib/python3.13/site-packages",
        "MCW_PUBLIC_ICS_RADICALE_PYTHON": "/app/bin/python",
        "MCW_PUBLIC_ICS_NATIVE_THUNDERBIRD_BIN": "/task/app/thunderbird/thunderbird",
        "MCW_PUBLIC_ICS_NATIVE_WORKSPACE": "/task/workspace",
        "MCW_PUBLIC_ICS_RESULT_FILE": str(CONTAINER_RESULT_PATH),
    }


def _public_container_environment_matches(environment: dict[str, str]) -> bool:
    source_sha = environment.get("MCW_PUBLIC_ICS_SOURCE_SHA", "")
    if re.fullmatch(r"[0-9a-f]{40}", source_sha) is None:
        return False
    expected = _public_container_environment(source_sha)
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
    environment = dict(os.environ)
    if not _public_container_environment_matches(environment):
        return 1
    source_sha = environment["MCW_PUBLIC_ICS_SOURCE_SHA"]

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
        CONTAINER_RESULT_PATH.exists()
        or CONTAINER_RESULT_PATH.is_symlink()
        or CONTAINER_JEST_REPORT_PATH.exists()
        or CONTAINER_JEST_REPORT_PATH.is_symlink()
        or CONTAINER_FIXTURE_DIAGNOSTIC_PATH.exists()
        or CONTAINER_FIXTURE_DIAGNOSTIC_PATH.is_symlink()
    ):
        return 1

    def record_failure(
        stage: str,
        error_class: str,
        line: int | None = None,
        column: int | None = None,
    ) -> None:
        try:
            _write_fixture_diagnostic(
                CONTAINER_FIXTURE_DIAGNOSTIC_PATH,
                source_sha,
                stage,
                error_class,
                line,
                column,
            )
        except Exception:
            pass

    if (
        not node.is_file()
        or not os.access(node, os.X_OK)
        or not test_runner.is_file()
        or not test_path.is_file()
    ):
        record_failure("jest_runner", "worker_input_invalid")
        return 1

    result_code, failure = _invoke_public_jest(
        node=node,
        test_runner=test_runner,
        test_path=test_path,
        working_directory=source / "matrix-calendar-server",
        report_path=CONTAINER_JEST_REPORT_PATH,
        log_path=Path("/tmp/thunderbird-public-feed-jest.log"),
        cache_directory="/tmp/public-feed-jest-cache",
        timeout=JEST_TIMEOUT_SECONDS,
    )

    if failure is not None:
        record_failure(*failure)
        return 1
    if result_code != 0:
        return 1
    try:
        native_result = _read_native_result(CONTAINER_RESULT_PATH, allow_failed=True)
    except ValueError:
        record_failure("native_result", "native_result_invalid")
        return 1
    return 0 if native_result.get("status") == "passed" else 1


def _run() -> bool:
    try:
        source_sha = _source_sha()
        root, summary, workspace = _prepared(source_sha)
        host_result_path = root / "workspace" / NATIVE_RESULT_FILENAME
        host_diagnostic_path = root / "workspace" / FIXTURE_DIAGNOSTIC_FILENAME
        host_report_path = root / "workspace" / JEST_REPORT_FILENAME
        if any(
            path.exists() or path.is_symlink()
            for path in (host_result_path, host_diagnostic_path, host_report_path)
        ):
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
            extra_environment=_public_container_environment(source_sha),
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
                fixture_diagnostic = _read_fixture_diagnostic(
                    host_diagnostic_path, source_sha
                )
                if fixture_diagnostic is not None:
                    summary.update(fixture_diagnostic)
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
