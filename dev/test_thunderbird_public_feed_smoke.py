#!/usr/bin/env python3
"""Offline checks for the closed native Thunderbird public ICS profile."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("thunderbird-public-feed-smoke.py")
SPEC = importlib.util.spec_from_file_location("public_feed_smoke", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("public feed smoke runner is unavailable")
PUBLIC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PUBLIC)

SOURCE_SHA = "a" * 40
APP_VERSION = "158.0.1"
NODE_VERSION = "22.23.3"
KNOWN_FIXTURE_FRAME = (
    "at Object.<anonymous> (/task/source/matrix-calendar-server/test/integration/"
    "PrivateCalendarClientRadicaleContract.test.ts:804:19)"
)


class PublicFeedSmokeTests(unittest.TestCase):
    def _write_jest_report(self, path: Path, value: object) -> Path:
        path.write_text(json.dumps(value), encoding="utf-8")
        path.chmod(0o600)
        return path

    def _failed_jest_report(self, message: str = KNOWN_FIXTURE_FRAME) -> dict:
        return {
            "success": False,
            "testResults": [
                {
                    "name": "/task/source/matrix-calendar-server/test/integration/"
                    "PrivateCalendarClientRadicaleContract.test.ts",
                    "status": "failed",
                    "assertionResults": [
                        {
                            "status": "failed",
                            "failureMessages": [message],
                        }
                    ],
                }
            ],
        }

    def _native_result(self) -> dict[str, object]:
        return {
            "schema": PUBLIC.RESULT_SCHEMA,
            "status": "passed",
            "appVersion": APP_VERSION,
            **{field: True for field in PUBLIC.PREDICATE_FIELDS},
            "gatewayGetCount": 4,
            "exactRouteCount": 4,
            "authorizationAbsentCount": 4,
            "http200Count": 3,
            "http404Count": 1,
        }

    def _summary(self) -> dict[str, object]:
        summary = PUBLIC._initial_summary(SOURCE_SHA)
        summary.update(
            {
                "phase": "fixture_run",
                "nodeVersion": NODE_VERSION,
                "appVersion": APP_VERSION,
                "gatewayGetCount": 4,
                "exactRouteCount": 4,
                "authorizationAbsentCount": 4,
                "http200Count": 3,
                "http404Count": 1,
            }
        )
        for field in PUBLIC.SUMMARY_BOOLEAN_FIELDS:
            summary[field] = True
        return summary

    def _outcome_environment(self) -> dict[str, str]:
        return {
            "TB_PUBLIC_IMAGE_OUTCOME": "success",
            "TB_PUBLIC_WORKSPACE_OUTCOME": "success",
            "TB_PUBLIC_PREFLIGHT_OUTCOME": "success",
            "TB_PUBLIC_STARTUP_PREPARE_OUTCOME": "success",
            "TB_PUBLIC_PROFILE_PREPARE_OUTCOME": "success",
            "TB_PUBLIC_RUN_OUTCOME": "success",
        }

    def _write_owner_marker(self, task_root: Path) -> None:
        task_root.mkdir(mode=0o700)
        marker = PUBLIC.SMOKE._owned_marker(task_root, SOURCE_SHA)
        marker.write_text(
            json.dumps(
                {
                    "schema": "thunderbird-calendar-smoke-owner@1",
                    "source_sha": SOURCE_SHA,
                }
            )
            + "\n",
            encoding="utf-8",
        )
        marker.chmod(0o600)

    def _make_startup_artifact_fixture(
        self, base: Path
    ) -> tuple[Path, Path, dict[str, str]]:
        runner_temp = base / "runner-temp"
        runner_temp.mkdir()
        task_root = base / "task-root"
        binary = task_root / "app" / "thunderbird" / "thunderbird"
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b"fixture Thunderbird binary")
        binary.chmod(0o700)
        python_link = task_root / "venv" / "bin" / "python"
        python_link.parent.mkdir(parents=True)
        python_link.symlink_to("/usr/local/bin/python3.13")
        marionette = (
            task_root
            / "venv"
            / "lib"
            / "python3.13"
            / "site-packages"
            / "marionette_driver"
            / "marionette.py"
        )
        marionette.parent.mkdir(parents=True)
        marionette.write_text("# fixture module\n", encoding="utf-8")

        startup_summary = PUBLIC.SMOKE._initial_summary(SOURCE_SHA)
        startup_summary.update(
            {
                "phase": "dependency_install",
                "archive_sha256_verified": True,
                "archive_sha512_verified": True,
                "python_artifacts_verified": True,
                "docker_backend_verified": True,
                "docker_isolation_verified": True,
            }
        )
        startup_summary_path = runner_temp / "thunderbird-calendar-smoke-summary.json"
        startup_summary_path.write_text(json.dumps(startup_summary), encoding="utf-8")
        startup_summary_path.chmod(0o600)
        environment = {"RUNNER_TEMP": str(runner_temp)}
        return task_root, startup_summary_path, environment

    def test_startup_artifact_preflight_reports_each_closed_boundary(self) -> None:
        cases = (
            "summary_malformed",
            "summary_mode",
            "summary_owner",
            "summary_schema",
            "summary_source",
            "binary_artifact",
            "venv_layout",
            "marionette_module",
            "container_interpreter_probe",
        )
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temporary:
                task_root, summary_path, environment = (
                    self._make_startup_artifact_fixture(Path(temporary))
                )
                binary = task_root / "app" / "thunderbird" / "thunderbird"
                python_link = task_root / "venv" / "bin" / "python"
                marionette = (
                    task_root
                    / "venv"
                    / "lib"
                    / "python3.13"
                    / "site-packages"
                    / "marionette_driver"
                    / "marionette.py"
                )
                original_summary = summary_path.read_bytes()
                summary = json.loads(original_summary)
                expected_reason = {
                    "summary_malformed": "summary_contract_invalid",
                    "summary_mode": "summary_contract_invalid",
                    "summary_owner": "summary_contract_invalid",
                    "summary_schema": "summary_contract_invalid",
                    "summary_source": "summary_contract_invalid",
                    "binary_artifact": "binary_artifact_invalid",
                    "venv_layout": "venv_layout_invalid",
                    "marionette_module": "marionette_module_invalid",
                    "container_interpreter_probe": "container_interpreter_probe_failed",
                }[case]

                if case == "summary_malformed":
                    summary_path.write_text("{invalid", encoding="utf-8")
                    summary_path.chmod(0o600)
                elif case == "summary_mode":
                    summary_path.chmod(0o644)
                elif case == "summary_schema":
                    summary["schema"] = "thunderbird-calendar-startup-smoke@0"
                    summary_path.write_text(json.dumps(summary), encoding="utf-8")
                    summary_path.chmod(0o600)
                elif case == "summary_source":
                    summary["source_sha"] = "b" * 40
                    summary_path.write_text(json.dumps(summary), encoding="utf-8")
                    summary_path.chmod(0o600)
                elif case == "binary_artifact":
                    binary.unlink()
                elif case == "venv_layout":
                    python_link.unlink()
                elif case == "marionette_module":
                    marionette.unlink()

                with (
                    patch.dict(os.environ, environment),
                    patch.object(
                        PUBLIC.SMOKE,
                        "_capture_container",
                        side_effect=(
                            PUBLIC.SMOKE.SmokeFailure("preflight", "invalid_input")
                            if case == "container_interpreter_probe"
                            else None
                        ),
                    ),
                ):
                    if case == "summary_owner":
                        with self.assertRaises(
                            PUBLIC.StartupArtifactsPreflightFailure
                        ) as failure:
                            with patch.object(
                                PUBLIC.os,
                                "getuid",
                                return_value=os.getuid() + 1,
                            ):
                                PUBLIC._require_startup_artifacts(task_root, SOURCE_SHA)
                    else:
                        with self.assertRaises(
                            PUBLIC.StartupArtifactsPreflightFailure
                        ) as failure:
                            PUBLIC._require_startup_artifacts(task_root, SOURCE_SHA)
                    self.assertEqual(failure.exception.reason, expected_reason)

                summary_path.write_bytes(original_summary)
                summary_path.chmod(0o600)

    def test_startup_preflight_failure_is_closed_in_prepare_summary(
        self,
    ) -> None:
        cases = (
            (
                "known boundary",
                PUBLIC.StartupArtifactsPreflightFailure("venv_layout_invalid"),
                "venv_layout_invalid",
            ),
            (
                "unknown exception",
                RuntimeError("private exception detail"),
                "unknown",
            ),
        )
        for label, failure, expected_reason in cases:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temporary:
                base = Path(temporary)
                runner_temp = base / "runner-temp"
                runner_temp.mkdir()
                task_root = base / "task-root"
                environment = {
                    "RUNNER_TEMP": str(runner_temp),
                    "GITHUB_SHA": SOURCE_SHA,
                    "GITHUB_RUN_ID": "17",
                    "GITHUB_RUN_ATTEMPT": "1",
                }
                with (
                    patch.dict(os.environ, environment),
                    patch.object(PUBLIC, "_task_root", return_value=task_root),
                    patch.object(
                        PUBLIC.SMOKE,
                        "_require_preflight",
                        return_value={
                            "docker_backend_verified": True,
                            "docker_isolation_verified": True,
                        },
                    ),
                    patch.object(PUBLIC.SMOKE, "_verify_owner"),
                    patch.object(PUBLIC, "_workspace", return_value=base),
                    patch.object(
                        PUBLIC,
                        "_require_startup_artifacts",
                        side_effect=failure,
                    ),
                ):
                    self.assertFalse(PUBLIC._prepare())
                    summary = PUBLIC._load_summary()

                self.assertEqual(
                    summary["failure_stage"], "startup_artifacts_preflight"
                )
                self.assertEqual(
                    summary["failure_class"], "startup_artifacts_preflight_failed"
                )
                self.assertEqual(summary["startupArtifactsFailure"], expected_reason)
                self.assertTrue(summary["dockerBackendVerified"])
                self.assertTrue(summary["dockerIsolationVerified"])
                self.assertTrue(summary["workspaceJestReady"])
                self.assertTrue(
                    all(
                        not summary[field]
                        for field in {
                            "startupArtifactsVerified",
                            "thunderbirdArchiveVerified",
                            "marionetteArtifactsVerified",
                            "nativeProviderPassed",
                            *PUBLIC.PREDICATE_FIELDS,
                        }
                    )
                )
                self.assertNotIn("private exception detail", json.dumps(summary))

    def test_startup_artifact_subreason_is_a_closed_summary_field(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            runner_temp = Path(temporary)
            environment = {"RUNNER_TEMP": str(runner_temp)}
            with patch.dict(os.environ, environment):
                summary = PUBLIC._initial_summary(SOURCE_SHA)
                summary["startupArtifactsFailure"] = "private exception detail"
                PUBLIC._write_summary(summary)
                saved = PUBLIC._load_summary()
                serialized = PUBLIC._summary_path().read_text(encoding="utf-8")

                self.assertEqual(saved["failure_stage"], "complete")
                self.assertEqual(saved["failure_class"], "internal_error")
                self.assertIsNone(saved["startupArtifactsFailure"])
                self.assertNotIn("private exception detail", serialized)

                saved["startupArtifactsFailure"] = "unbounded exception detail"
                path = PUBLIC._summary_path()
                path.write_text(json.dumps(saved), encoding="utf-8")
                path.chmod(0o600)
                with self.assertRaises(ValueError):
                    PUBLIC._load_summary()

    def test_finalizer_uses_unknown_for_unreported_startup_prepare_failure(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            runner_temp = base / "runner-temp"
            runner_temp.mkdir()
            task_parent = base / "task-roots"
            task_parent.mkdir()
            environment = {
                "RUNNER_TEMP": str(runner_temp),
                "GITHUB_SHA": SOURCE_SHA,
                "GITHUB_RUN_ID": "17",
                "GITHUB_RUN_ATTEMPT": "1",
                **self._outcome_environment(),
                "TB_PUBLIC_STARTUP_PREPARE_OUTCOME": "failure",
            }
            with (
                patch.dict(os.environ, environment),
                patch.object(PUBLIC.SMOKE, "ROOT_PARENT", task_parent),
            ):
                PUBLIC._write_summary(PUBLIC._initial_summary(SOURCE_SHA))
                self.assertFalse(PUBLIC._finalize())
                summary = PUBLIC._load_summary()
            self.assertEqual(summary["failure_stage"], "startup_artifacts_preflight")
            self.assertEqual(
                summary["failure_class"], "startup_artifacts_preflight_failed"
            )
            self.assertEqual(summary["startupArtifactsFailure"], "unknown")

    def test_every_public_native_predicate_and_count_is_a_success_gate(self) -> None:
        result = self._native_result()
        self.assertTrue(PUBLIC._valid_native_result(result))
        for predicate in PUBLIC.PREDICATE_FIELDS:
            candidate = dict(result)
            candidate[predicate] = False
            with self.subTest(predicate=predicate):
                self.assertFalse(PUBLIC._valid_native_result(candidate))

        invalid_counts = (
            {"gatewayGetCount": 2},
            {"exactRouteCount": 3},
            {"authorizationAbsentCount": 3},
            {"http200Count": 1},
            {"http404Count": 0},
            {"http404Count": 2},
            {"gatewayGetCount": True},
        )
        for changes in invalid_counts:
            with self.subTest(changes=changes):
                self.assertFalse(PUBLIC._valid_native_result({**result, **changes}))

        for predicate in PUBLIC.SUMMARY_BOOLEAN_FIELDS:
            candidate = self._summary()
            candidate[predicate] = False
            with self.subTest(summary_predicate=predicate):
                self.assertFalse(PUBLIC._success_gates(candidate))
        old_node = self._summary()
        old_node["nodeVersion"] = "22.11.9"
        self.assertFalse(PUBLIC._success_gates(old_node))

    def test_timeout_budget_orders_worker_fixture_jest_container_and_workflow(
        self,
    ) -> None:
        worker_source_path = (
            Path(__file__).parents[1]
            / "radicale-auth"
            / "tests"
            / "public_calendar_feed_thunderbird_contract.py"
        )
        worker_spec = importlib.util.spec_from_file_location(
            "public_calendar_feed_thunderbird_contract_budget", worker_source_path
        )
        self.assertIsNotNone(worker_spec)
        self.assertIsNotNone(worker_spec.loader)
        worker_environment = {
            "MCW_PUBLIC_ICS_API_ORIGIN": "https://localhost:8443",
            "MCW_PUBLIC_ICS_URL": "https://localhost:8443/v1/public-calendar-feeds/synthetic.envelope",
            "MCW_PUBLIC_ICS_CONTROL_PORT": "12345",
            "MCW_PUBLIC_ICS_CONTROL_KEY": "a" * 43,
            "MCW_PUBLIC_ICS_CA_FILE": "/tmp/synthetic-ca.pem",
            "MCW_PUBLIC_ICS_NATIVE_THUNDERBIRD_BIN": "/tmp/thunderbird",
            "MCW_PUBLIC_ICS_NATIVE_WORKSPACE": "/task/workspace",
        }
        native_worker = importlib.util.module_from_spec(worker_spec)
        with patch.dict(os.environ, worker_environment):
            worker_spec.loader.exec_module(native_worker)
        self.assertEqual(native_worker.WORKER_PHASE_BUDGET_SECONDS, 615)

        fixture = (
            Path(__file__).parents[1]
            / "matrix-calendar-server"
            / "test"
            / "integration"
            / "PrivateCalendarClientRadicaleContract.test.ts"
        )
        fixture_source = fixture.read_text(encoding="utf-8")
        fixture_timeout = re.search(
            r"PUBLIC_NATIVE_FIXTURE_TIMEOUT_MS\s*=\s*\n\s*PUBLIC_NATIVE_WORKER_TIMEOUT_MS\s*\+\s*\n\s*PUBLIC_NATIVE_CHILD_TERMINATION_GRACE_MS\s*\+\s*\n\s*PUBLIC_NATIVE_FIXTURE_SETUP_TEARDOWN_MARGIN_MS",
            fixture_source,
        )
        self.assertIsNotNone(fixture_timeout)
        fixture_values = {
            name: int(match.group(1).replace("_", ""))
            for name in (
                "PUBLIC_NATIVE_WORKER_TIMEOUT_MS",
                "PUBLIC_NATIVE_CHILD_TERMINATION_GRACE_MS",
                "PUBLIC_NATIVE_FIXTURE_SETUP_TEARDOWN_MARGIN_MS",
            )
            if (match := re.search(rf"{name}\s*=\s*([0-9_]+)", fixture_source))
        }
        self.assertEqual(
            set(fixture_values),
            {
                "PUBLIC_NATIVE_WORKER_TIMEOUT_MS",
                "PUBLIC_NATIVE_CHILD_TERMINATION_GRACE_MS",
                "PUBLIC_NATIVE_FIXTURE_SETUP_TEARDOWN_MARGIN_MS",
            },
        )
        self.assertGreaterEqual(
            fixture_values["PUBLIC_NATIVE_WORKER_TIMEOUT_MS"],
            native_worker.WORKER_PHASE_BUDGET_SECONDS * 1000,
        )
        self.assertEqual(
            fixture_values["PUBLIC_NATIVE_WORKER_TIMEOUT_MS"],
            native_worker.WORKER_PHASE_BUDGET_SECONDS * 1000 + 45_000,
        )
        self.assertEqual(
            fixture_values["PUBLIC_NATIVE_CHILD_TERMINATION_GRACE_MS"], 3_000
        )
        self.assertEqual(
            fixture_values["PUBLIC_NATIVE_FIXTURE_SETUP_TEARDOWN_MARGIN_MS"],
            180_000,
        )
        fixture_ms = sum(fixture_values.values())
        self.assertEqual(fixture_ms, 843_000)
        self.assertIn("nativeThunderbirdProfile\n          ? 240_000", fixture_source)
        self.assertIn("waitForChild(nativeProcess, 180_000)", fixture_source)
        self.assertEqual(
            PUBLIC.JEST_TIMEOUT_SECONDS * 1000,
            fixture_ms + PUBLIC.JEST_PROCESS_MARGIN_SECONDS * 1000,
        )
        self.assertEqual(
            PUBLIC.NATIVE_TIMEOUT_SECONDS * 1000,
            PUBLIC.JEST_TIMEOUT_SECONDS * 1000
            + PUBLIC.CONTAINER_CLEANUP_MARGIN_SECONDS * 1000,
        )

        workflow = (
            Path(__file__).parents[1] / ".github" / "workflows" / "readme-gallery.yml"
        ).read_text(encoding="utf-8")
        public_job = workflow.split("  public-ics-feed-smoke:", maxsplit=1)[1]
        workflow_timeout = re.search(r"(?m)^    timeout-minutes: ([0-9]+)$", public_job)
        self.assertIsNotNone(workflow_timeout)
        self.assertGreater(
            int(workflow_timeout.group(1)) * 60,
            PUBLIC.NATIVE_TIMEOUT_SECONDS,
        )

    def test_public_native_worker_tests_run_in_radicale_auth_only_tree(self) -> None:
        source_root = Path(__file__).parents[1] / "radicale-auth"
        with tempfile.TemporaryDirectory(prefix="mcw-public-auth-only-") as temporary:
            isolated_root = Path(temporary) / "radicale-auth"
            shutil.copytree(
                source_root,
                isolated_root,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            )
            self.assertFalse((Path(temporary) / "matrix-calendar-server").exists())
            self.assertFalse((Path(temporary) / "dev").exists())
            result = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    str(
                        isolated_root
                        / "tests"
                        / "test_public_calendar_feed_thunderbird_contract.py"
                    ),
                ],
                cwd=isolated_root,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0)
            self.assertRegex(result.stderr, r"Ran [1-9][0-9]* tests?\b")

    def test_native_failure_result_has_its_own_closed_stage_and_class_allowlists(
        self,
    ) -> None:
        result = {
            "schema": PUBLIC.RESULT_SCHEMA,
            "status": "failed",
            "failure_stage": "revoked_refresh",
            "failure_class": "revoked_route_not_observed",
        }
        self.assertTrue(PUBLIC._valid_native_result(result, allow_failed=True))
        self.assertFalse(
            PUBLIC._valid_native_result(
                {**result, "failure_stage": "startup_artifacts_preflight"},
                allow_failed=True,
            )
        )
        self.assertFalse(
            PUBLIC._valid_native_result(
                {**result, "failure_class": "https://private.example/token"},
                allow_failed=True,
            )
        )
        self.assertFalse(
            PUBLIC._valid_native_result(
                {**result, "url": "https://private.example/token"},
                allow_failed=True,
            )
        )

    def test_public_jest_projection_is_closed_and_only_keeps_known_frame_numbers(
        self,
    ) -> None:
        projected = PUBLIC._classify_public_jest_report(
            self._failed_jest_report("private fixture value\n" + KNOWN_FIXTURE_FRAME)
        )
        self.assertEqual(
            projected,
            ("fixture_run", "jest_assertion_failed", 804, 19),
        )
        self.assertNotIn("private fixture value", repr(projected))
        self.assertNotIn(
            "PrivateCalendarClientRadicaleContract.test.ts", repr(projected)
        )

        unknown_frame = self._failed_jest_report(
            "at Object.<anonymous> (/tmp/unrelated/Other.test.ts:44:7)"
        )
        self.assertEqual(
            PUBLIC._classify_public_jest_report(unknown_frame),
            ("fixture_run", "jest_assertion_failed", None, None),
        )
        forged_frame = self._failed_jest_report(
            "assertion data mentions matrix-calendar-server/test/integration/"
            "PrivateCalendarClientRadicaleContract.test.ts:804:19"
        )
        self.assertEqual(
            PUBLIC._classify_public_jest_report(forged_frame),
            ("fixture_run", "jest_assertion_failed", None, None),
        )
        self.assertEqual(
            PUBLIC._classify_public_jest_report(
                {
                    "success": False,
                    "testResults": [
                        {
                            "status": "failed",
                            "assertionResults": [],
                        }
                    ],
                }
            ),
            ("suite_load", "jest_suite_failed", None, None),
        )
        self.assertEqual(
            PUBLIC._classify_public_jest_report({"success": False}),
            ("jest_runner", "jest_report_invalid", None, None),
        )
        self.assertIsNone(
            PUBLIC._classify_public_jest_report(
                {
                    "success": True,
                    "testResults": [
                        {
                            "status": "passed",
                            "assertionResults": [{"status": "passed"}],
                        }
                    ],
                }
            )
        )

    def test_public_jest_report_reader_rejects_unsafe_or_malformed_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            report = self._write_jest_report(
                root / "report.json", self._failed_jest_report()
            )
            self.assertEqual(
                PUBLIC.JEST_REPORT.read_owned_json_object(
                    report, max_bytes=PUBLIC.MAX_JEST_REPORT_BYTES
                )["success"],
                False,
            )

            report.write_text(
                '{"success":false,"success":false,"testResults":[]}',
                encoding="utf-8",
            )
            report.chmod(0o600)
            with self.assertRaises(ValueError):
                PUBLIC.JEST_REPORT.read_owned_json_object(
                    report, max_bytes=PUBLIC.MAX_JEST_REPORT_BYTES
                )

            report.write_text("{malformed", encoding="utf-8")
            report.chmod(0o600)
            with self.assertRaises(ValueError):
                PUBLIC.JEST_REPORT.read_owned_json_object(
                    report, max_bytes=PUBLIC.MAX_JEST_REPORT_BYTES
                )

            report.write_bytes(b" " * (PUBLIC.MAX_JEST_REPORT_BYTES + 1))
            report.chmod(0o600)
            with self.assertRaises(ValueError):
                PUBLIC.JEST_REPORT.read_owned_json_object(
                    report, max_bytes=PUBLIC.MAX_JEST_REPORT_BYTES
                )

            report.write_text("{}", encoding="utf-8")
            report.chmod(0o644)
            with self.assertRaises(ValueError):
                PUBLIC.JEST_REPORT.read_owned_json_object(
                    report, max_bytes=PUBLIC.MAX_JEST_REPORT_BYTES
                )

            report.chmod(0o600)
            link = root / "report-link.json"
            link.symlink_to(report)
            with self.assertRaises(ValueError):
                PUBLIC.JEST_REPORT.read_owned_json_object(
                    link, max_bytes=PUBLIC.MAX_JEST_REPORT_BYTES
                )

            with patch.object(PUBLIC.os, "getuid", return_value=os.getuid() + 1):
                with self.assertRaises(ValueError):
                    PUBLIC.JEST_REPORT.read_owned_json_object(
                        report, max_bytes=PUBLIC.MAX_JEST_REPORT_BYTES
                    )

    def test_public_jest_runner_requests_report_and_always_removes_it(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            working_directory = root / "project"
            test_path = (
                working_directory
                / "matrix-calendar-server"
                / "test"
                / "integration"
                / "PrivateCalendarClientRadicaleContract.test.ts"
            )
            test_path.parent.mkdir(parents=True)
            test_path.write_text("// synthetic test path\n", encoding="utf-8")
            report_path = root / "workspace" / PUBLIC.JEST_REPORT_FILENAME
            report_path.parent.mkdir()
            log_path = root / "jest.log"
            observed: dict[str, object] = {}

            def failed_jest(command: list[str], **_kwargs: object):
                observed["command"] = command
                output = Path(command[command.index("--outputFile") + 1])
                output.write_text(
                    json.dumps(self._failed_jest_report()), encoding="utf-8"
                )
                output.chmod(0o600)
                return subprocess.CompletedProcess(command, 1)

            with patch.object(PUBLIC.subprocess, "run", side_effect=failed_jest):
                exit_code, failure = PUBLIC._invoke_public_jest(
                    node=Path("/cached/node22"),
                    test_runner=Path("/cached/jest.js"),
                    test_path=test_path,
                    working_directory=working_directory,
                    report_path=report_path,
                    log_path=log_path,
                    cache_directory=str(root / "cache"),
                    timeout=10,
                )

            command = observed["command"]
            self.assertIsInstance(command, list)
            self.assertIn("--json", command)
            self.assertIn("--outputFile", command)
            self.assertEqual(exit_code, 1)
            self.assertEqual(
                failure,
                ("fixture_run", "jest_assertion_failed", 804, 19),
            )
            self.assertFalse(report_path.exists())
            self.assertEqual(log_path.stat().st_mode & 0o777, 0o600)

            def passing_jest(command: list[str], **_kwargs: object):
                output = Path(command[command.index("--outputFile") + 1])
                output.write_text(
                    json.dumps(
                        {
                            "success": True,
                            "testResults": [
                                {
                                    "status": "passed",
                                    "assertionResults": [{"status": "passed"}],
                                }
                            ],
                        }
                    ),
                    encoding="utf-8",
                )
                output.chmod(0o600)
                return subprocess.CompletedProcess(command, 0)

            log_path.unlink()
            with patch.object(PUBLIC.subprocess, "run", side_effect=passing_jest):
                exit_code, failure = PUBLIC._invoke_public_jest(
                    node=Path("/cached/node22"),
                    test_runner=Path("/cached/jest.js"),
                    test_path=test_path,
                    working_directory=working_directory,
                    report_path=report_path,
                    log_path=log_path,
                    cache_directory=str(root / "cache"),
                    timeout=10,
                )
            self.assertEqual(exit_code, 0)
            self.assertIsNone(failure)
            self.assertFalse(report_path.exists())

    def test_fixture_diagnostic_is_source_bound_closed_and_mode_checked(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / PUBLIC.FIXTURE_DIAGNOSTIC_FILENAME
            invalid_path = root / "invalid-diagnostic.json"
            with self.assertRaises(ValueError):
                PUBLIC._write_fixture_diagnostic(
                    invalid_path,
                    SOURCE_SHA,
                    "fixture_run",
                    "private assertion value",
                )
            self.assertFalse(invalid_path.exists())
            PUBLIC._write_fixture_diagnostic(
                path, SOURCE_SHA, "fixture_run", "jest_assertion_failed", 804, 19
            )
            expected = {
                "fixtureFailureStage": "fixture_run",
                "fixtureFailureClass": "jest_assertion_failed",
                "fixtureFailureLine": 804,
                "fixtureFailureColumn": 19,
            }
            self.assertEqual(
                PUBLIC._read_fixture_diagnostic(path, SOURCE_SHA), expected
            )
            self.assertIsNone(PUBLIC._read_fixture_diagnostic(path, "b" * 40))

            path.chmod(0o644)
            self.assertIsNone(PUBLIC._read_fixture_diagnostic(path, SOURCE_SHA))
            path.chmod(0o600)
            link = root / "diagnostic-link.json"
            link.symlink_to(path)
            self.assertIsNone(PUBLIC._read_fixture_diagnostic(link, SOURCE_SHA))

            path.write_text('{"schema":"bad","schema":"duplicate"}', encoding="utf-8")
            path.chmod(0o600)
            self.assertIsNone(PUBLIC._read_fixture_diagnostic(path, SOURCE_SHA))

            path.write_text("not json", encoding="utf-8")
            path.chmod(0o600)
            self.assertIsNone(PUBLIC._read_fixture_diagnostic(path, SOURCE_SHA))

            path.write_bytes(b" " * (PUBLIC.MAX_FIXTURE_DIAGNOSTIC_BYTES + 1))
            path.chmod(0o600)
            self.assertIsNone(PUBLIC._read_fixture_diagnostic(path, SOURCE_SHA))

    def test_fixture_phase_marker_is_source_bound_closed_and_mode_checked(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / PUBLIC.FIXTURE_PHASE_FILENAME
            invalid_path = root / "invalid-phase.json"
            with self.assertRaises(ValueError):
                PUBLIC._write_fixture_phase_marker(
                    invalid_path, SOURCE_SHA, "raw assertion detail"
                )
            with self.assertRaises(ValueError):
                PUBLIC._write_fixture_phase_marker(path, "not-a-commit", "jest_start")
            self.assertFalse(path.exists())

            PUBLIC._write_fixture_phase_marker(path, SOURCE_SHA, "jest_start")
            self.assertEqual(
                PUBLIC._read_fixture_phase_marker(path, SOURCE_SHA), "jest_start"
            )
            self.assertIsNone(PUBLIC._read_fixture_phase_marker(path, "b" * 40))
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(set(saved), {"schema", "profile", "source_sha", "phase"})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

            path.write_text(
                json.dumps({**saved, "profile": "private"}), encoding="utf-8"
            )
            path.chmod(0o600)
            self.assertIsNone(PUBLIC._read_fixture_phase_marker(path, SOURCE_SHA))

            path.write_text(
                json.dumps({**saved, "phase": "event title"}), encoding="utf-8"
            )
            path.chmod(0o600)
            self.assertIsNone(PUBLIC._read_fixture_phase_marker(path, SOURCE_SHA))

            path.write_text('{"schema":"bad","schema":"duplicate"}', encoding="utf-8")
            path.chmod(0o600)
            self.assertIsNone(PUBLIC._read_fixture_phase_marker(path, SOURCE_SHA))

            path.write_text("{malformed", encoding="utf-8")
            path.chmod(0o600)
            self.assertIsNone(PUBLIC._read_fixture_phase_marker(path, SOURCE_SHA))

            path.write_bytes(b" " * (PUBLIC.MAX_FIXTURE_PHASE_BYTES + 1))
            path.chmod(0o600)
            self.assertIsNone(PUBLIC._read_fixture_phase_marker(path, SOURCE_SHA))

            path.write_text(json.dumps(saved), encoding="utf-8")
            path.chmod(0o644)
            self.assertIsNone(PUBLIC._read_fixture_phase_marker(path, SOURCE_SHA))
            path.chmod(0o600)
            link = root / "phase-link.json"
            link.symlink_to(path)
            self.assertIsNone(PUBLIC._read_fixture_phase_marker(link, SOURCE_SHA))

            with patch.object(PUBLIC.os, "getuid", return_value=os.getuid() + 1):
                self.assertIsNone(PUBLIC._read_fixture_phase_marker(path, SOURCE_SHA))

    def test_run_projects_fixture_failure_without_setting_native_success_flags(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            runner_temp = base / "runner-temp"
            runner_temp.mkdir()
            task_root = base / "task-root"
            workspace = base / "workspace"
            task_workspace = task_root / "workspace"
            task_workspace.mkdir(parents=True)
            summary = PUBLIC._initial_summary(SOURCE_SHA)
            summary["phase"] = "prepare"

            def fail_before_native_result(*_args: object, **kwargs: object) -> int:
                self.assertEqual(
                    kwargs["extra_environment"]["MCW_PUBLIC_ICS_SOURCE_SHA"],
                    SOURCE_SHA,
                )
                phase_path = task_workspace / PUBLIC.FIXTURE_PHASE_FILENAME
                self.assertEqual(
                    PUBLIC._read_fixture_phase_marker(phase_path, SOURCE_SHA),
                    "jest_start",
                )
                phase_path.write_text(
                    json.dumps(
                        {
                            "schema": PUBLIC.FIXTURE_PHASE_SCHEMA,
                            "profile": "public_ics",
                            "source_sha": SOURCE_SHA,
                            "phase": "radicale_ready",
                        }
                    )
                    + "\n",
                    encoding="utf-8",
                )
                phase_path.chmod(0o600)
                PUBLIC._write_fixture_diagnostic(
                    task_workspace / PUBLIC.FIXTURE_DIAGNOSTIC_FILENAME,
                    SOURCE_SHA,
                    "fixture_run",
                    "jest_assertion_failed",
                    804,
                    19,
                )
                return 1

            with (
                patch.dict(
                    os.environ,
                    {"RUNNER_TEMP": str(runner_temp), "GITHUB_SHA": SOURCE_SHA},
                ),
                patch.object(
                    PUBLIC,
                    "_prepared",
                    return_value=(task_root, summary, workspace),
                ),
                patch.object(
                    PUBLIC.SMOKE,
                    "_run_container_bounded",
                    side_effect=fail_before_native_result,
                ),
            ):
                self.assertFalse(PUBLIC._run())
                saved = PUBLIC._load_summary()

            self.assertEqual(saved["failure_stage"], "fixture_run")
            self.assertEqual(saved["failure_class"], "jest_failed")
            self.assertEqual(saved["fixtureFailureStage"], "fixture_run")
            self.assertEqual(saved["fixtureFailureClass"], "jest_assertion_failed")
            self.assertEqual(saved["fixtureFailureLine"], 804)
            self.assertEqual(saved["fixtureFailureColumn"], 19)
            self.assertEqual(saved["fixtureLastPhase"], "radicale_ready")
            self.assertTrue(
                all(not saved[field] for field in PUBLIC.SUMMARY_BOOLEAN_FIELDS)
            )
            self.assertTrue(all(saved[field] == 0 for field in PUBLIC.COUNT_FIELDS))
            self.assertEqual(set(saved), set(PUBLIC._initial_summary(SOURCE_SHA)))

    def test_run_reports_invalid_phase_marker_as_a_fixed_closed_value(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            runner_temp = base / "runner-temp"
            runner_temp.mkdir()
            task_root = base / "task-root"
            task_workspace = task_root / "workspace"
            task_workspace.mkdir(parents=True)
            summary = PUBLIC._initial_summary(SOURCE_SHA)

            def fail_without_marker(*_args: object, **_kwargs: object) -> int:
                (task_workspace / PUBLIC.FIXTURE_PHASE_FILENAME).unlink()
                return 1

            with (
                patch.dict(
                    os.environ,
                    {"RUNNER_TEMP": str(runner_temp), "GITHUB_SHA": SOURCE_SHA},
                ),
                patch.object(
                    PUBLIC,
                    "_prepared",
                    return_value=(task_root, summary, base / "workspace"),
                ),
                patch.object(
                    PUBLIC.SMOKE,
                    "_run_container_bounded",
                    side_effect=fail_without_marker,
                ),
            ):
                self.assertFalse(PUBLIC._run())
                saved = PUBLIC._load_summary()

            self.assertEqual(saved["fixtureLastPhase"], "marker_invalid")
            self.assertFalse(saved["nativeProviderPassed"])
            self.assertTrue(all(saved[field] == 0 for field in PUBLIC.COUNT_FIELDS))

    def test_actual_jest_failure_projects_source_bound_phase_and_cleans_files(
        self,
    ) -> None:
        node_value = os.environ.get("MCW_VALIDATION_NODE22") or shutil.which("node")
        if node_value is None:
            self.skipTest("Node.js is unavailable")
        node = Path(node_value)
        if not node.is_file() or not os.access(node, os.X_OK):
            self.skipTest("retained Node.js binary is unavailable")
        node_version = subprocess.run(
            [str(node), "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            check=False,
            timeout=5,
        ).stdout.strip()
        if not re.fullmatch(r"v22\.[0-9]+\.[0-9]+", node_version):
            self.skipTest("Node.js 22 is unavailable")

        repository = PUBLIC.SCRIPT_DIR.parent
        test_runner = repository / "node_modules" / "jest" / "bin" / "jest.js"
        dependency_root = repository / "node_modules"
        if not test_runner.is_file() or not dependency_root.is_dir():
            self.skipTest("cached Jest dependencies are unavailable")

        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            runner_temp = base / "runner-temp"
            runner_temp.mkdir()
            task_root = base / "task-root"
            task_workspace = task_root / "workspace"
            task_workspace.mkdir(parents=True)
            logs = task_root / "logs"
            logs.mkdir()
            project = base / "project"
            server = project / "matrix-calendar-server"
            test_path = (
                server
                / "test"
                / "integration"
                / "PrivateCalendarClientRadicaleContract.test.ts"
            )
            test_path.parent.mkdir(parents=True)
            (server / "node_modules").symlink_to(
                dependency_root, target_is_directory=True
            )
            (server / "package.json").write_text(
                json.dumps(
                    {
                        "name": "public-phase-probe",
                        "version": "0.0.0",
                        "jest": {
                            "preset": "ts-jest",
                            "testEnvironment": "node",
                            "transform": {"^.+\\.(ts|tsx)$": "ts-jest"},
                            "testRegex": "PrivateCalendarClientRadicaleContract\\.test\\.ts$",
                            "moduleFileExtensions": ["ts", "tsx", "js"],
                            "roots": ["<rootDir>/test"],
                        },
                    }
                ),
                encoding="utf-8",
            )
            (server / "tsconfig.json").write_text(
                json.dumps(
                    {
                        "compilerOptions": {
                            "target": "ES2022",
                            "module": "commonjs",
                            "sourceMap": True,
                            "esModuleInterop": True,
                            "skipLibCheck": True,
                        }
                    }
                ),
                encoding="utf-8",
            )
            test_path.write_text(
                """
import { writeFileSync } from 'node:fs';

test('constant public phase failure', () => {
  const marker = {
    schema: 'thunderbird-public-feed-phase@1',
    profile: 'public_ics',
    source_sha: process.env.MCW_PHASE_PROBE_SOURCE_SHA,
    phase: 'initial_http_start',
  };
  writeFileSync(
    process.env.MCW_PHASE_PROBE_PATH as string,
    `${JSON.stringify(marker)}\\n`,
    { mode: 0o600 },
  );
  const failure = new Error('constant synthetic failure');
  failure.stack =
    'Error: constant synthetic failure\\n    at Object.<anonymous> (/tmp/unrelated.js:1:1)';
  throw failure;
});
""",
                encoding="utf-8",
            )

            summary = PUBLIC._initial_summary(SOURCE_SHA)
            marker_path = task_workspace / PUBLIC.FIXTURE_PHASE_FILENAME
            report_path = task_workspace / PUBLIC.JEST_REPORT_FILENAME
            log_path = logs / "public-feed-jest.log"
            environment = {
                "RUNNER_TEMP": str(runner_temp),
                "GITHUB_SHA": SOURCE_SHA,
                "MCW_PHASE_PROBE_PATH": str(marker_path),
                "MCW_PHASE_PROBE_SOURCE_SHA": SOURCE_SHA,
            }

            def run_actual_jest(*_args: object, **kwargs: object) -> int:
                self.assertEqual(
                    kwargs["extra_environment"]["MCW_PUBLIC_ICS_SOURCE_SHA"],
                    SOURCE_SHA,
                )
                result_code, failure = PUBLIC._invoke_public_jest(
                    node=node,
                    test_runner=test_runner,
                    test_path=test_path,
                    working_directory=server,
                    report_path=report_path,
                    log_path=log_path,
                    cache_directory=str(base / "jest-cache"),
                    timeout=60,
                )
                self.assertEqual(result_code, 1)
                self.assertIsNotNone(failure)
                if failure is None:
                    return 0
                self.assertEqual(failure[:2], ("fixture_run", "jest_assertion_failed"))
                self.assertEqual(failure[2:], (None, None))
                PUBLIC._write_fixture_diagnostic(
                    task_workspace / PUBLIC.FIXTURE_DIAGNOSTIC_FILENAME,
                    SOURCE_SHA,
                    *failure,
                )
                self.assertFalse(report_path.exists())
                return result_code

            with (
                patch.dict(os.environ, environment),
                patch.object(
                    PUBLIC,
                    "_prepared",
                    return_value=(task_root, summary, project),
                ),
                patch.object(
                    PUBLIC.SMOKE,
                    "_run_container_bounded",
                    side_effect=run_actual_jest,
                ),
            ):
                self.assertFalse(PUBLIC._run())
                saved = PUBLIC._load_summary()

            self.assertEqual(saved["fixtureFailureStage"], "fixture_run")
            self.assertEqual(saved["fixtureFailureClass"], "jest_assertion_failed")
            self.assertIsNone(saved["fixtureFailureLine"])
            self.assertIsNone(saved["fixtureFailureColumn"])
            self.assertEqual(saved["fixtureLastPhase"], "initial_http_start")
            self.assertFalse(saved["nativeProviderPassed"])
            self.assertTrue(all(saved[key] == 0 for key in PUBLIC.COUNT_FIELDS))
            self.assertFalse(report_path.exists())
            self.assertTrue(marker_path.exists())
            marker_path.unlink()
            log_path.unlink()
            (task_workspace / PUBLIC.FIXTURE_DIAGNOSTIC_FILENAME).unlink()
            self.assertFalse(marker_path.exists())
            self.assertFalse(log_path.exists())

    def test_container_environment_rejects_private_or_extra_public_credentials(
        self,
    ) -> None:
        environment = {
            "MCW_PUBLIC_FEED_NATIVE_PROFILE": "1",
            **PUBLIC._public_container_environment(SOURCE_SHA),
        }
        self.assertTrue(PUBLIC._public_container_environment_matches(environment))
        self.assertFalse(
            PUBLIC._public_container_environment_matches(
                {**environment, "PRIVATE_CALDAV_CONTRACT": "1"}
            )
        )
        self.assertFalse(
            PUBLIC._public_container_environment_matches(
                {**environment, "MCW_PRIVATE_CALDAV_SECRET": "fixture"}
            )
        )
        self.assertFalse(
            PUBLIC._public_container_environment_matches(
                {**environment, "MCW_PUBLIC_ICS_URL": "https://fixture.invalid/token"}
            )
        )

    def test_actual_startup_prepare_produces_public_profile_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            runner_temp = base / "runner-temp"
            runner_temp.mkdir()
            task_parent = base / "task-roots"
            task_parent.mkdir()
            workspace = base / "workspace"
            workspace.mkdir()
            (workspace / "package.json").write_text("{}\n", encoding="utf-8")
            jest = workspace / "node_modules" / "jest" / "bin" / "jest.js"
            jest.parent.mkdir(parents=True)
            jest.write_text("// fixture Jest entry\n", encoding="utf-8")
            fixture = (
                workspace
                / "matrix-calendar-server"
                / "test"
                / "integration"
                / "PrivateCalendarClientRadicaleContract.test.ts"
            )
            fixture.parent.mkdir(parents=True)
            fixture.write_text("// native public feed fixture\n", encoding="utf-8")
            (workspace / "dev").mkdir()
            (workspace / "dev" / "thunderbird-public-feed-smoke.py").write_text(
                "# runner fixture\n", encoding="utf-8"
            )

            tool_cache = base / "tool-cache"
            node = tool_cache / "node" / "22.23.3" / "bin" / "node"
            node.parent.mkdir(parents=True)
            node.write_text("#!/bin/sh\nprintf 'v22.23.3\\n'\n", encoding="utf-8")
            node.chmod(0o700)
            runner_home = base / "runner-home"
            runner_home.mkdir()

            environment = {
                "RUNNER_TEMP": str(runner_temp),
                "GITHUB_SHA": SOURCE_SHA,
                "GITHUB_RUN_ID": "17",
                "GITHUB_RUN_ATTEMPT": "1",
                "GITHUB_WORKSPACE": str(workspace),
                "RUNNER_TOOL_CACHE": str(tool_cache),
                "PATH": str(node.parent),
                "HOME": str(runner_home),
                "TB_DOCKER_IMAGE": f"thunderbird-calendar-smoke:{SOURCE_SHA}",
            }
            startup = PUBLIC.SMOKE
            preflight = startup._initial_summary(SOURCE_SHA)
            preflight.update(
                {
                    "docker_backend_verified": True,
                    "docker_isolation_verified": True,
                }
            )

            def dummy_download(
                _artifact: dict,
                destination: Path,
                _expected_host: str,
                **_kwargs: object,
            ) -> None:
                destination.write_bytes(b"temporary artifact")

            def dummy_extract(_archive_path: Path, destination: Path) -> Path:
                binary = destination / "thunderbird" / "thunderbird"
                binary.parent.mkdir(parents=True)
                binary.write_bytes(b"temporary Thunderbird binary")
                binary.chmod(0o700)
                return binary

            def dummy_install(task_root: Path, _packages: list[dict]) -> None:
                python_link = task_root / "venv" / "bin" / "python"
                python_link.parent.mkdir(parents=True)
                python_link.symlink_to("/usr/local/bin/python3.13")
                marionette = (
                    task_root
                    / "venv"
                    / "lib"
                    / "python3.13"
                    / "site-packages"
                    / "marionette_driver"
                    / "marionette.py"
                )
                marionette.parent.mkdir(parents=True)
                marionette.write_text("# fixture module\n", encoding="utf-8")

            with (
                patch.dict(os.environ, environment),
                patch.object(startup, "ROOT_PARENT", task_parent),
                patch.object(startup, "_download", side_effect=dummy_download),
                patch.object(startup, "_safe_extract", side_effect=dummy_extract),
                patch.object(
                    startup, "_install_dependencies", side_effect=dummy_install
                ),
            ):
                startup._write_summary(preflight)
                task_root = startup._root_path()
                startup_payload = startup._initial_summary(SOURCE_SHA)
                startup._prepare(
                    startup_payload, SOURCE_SHA, task_root, startup._load_lock()
                )
                startup._write_summary(startup_payload)
                startup_summary = json.loads(
                    startup._summary_path().read_text(encoding="utf-8")
                )
                self.assertEqual(startup_summary["phase"], "dependency_install")
                self.assertTrue(
                    PUBLIC._startup_artifacts_verified(startup_summary, SOURCE_SHA)
                )

                docker_calls = []
                real_subprocess_run = subprocess.run

                def fake_subprocess_run(command, **kwargs):
                    if command and command[0] == "docker":
                        docker_calls.append((list(command), kwargs.copy()))
                        return subprocess.CompletedProcess(
                            command, 0, stdout="", stderr=""
                        )
                    return real_subprocess_run(command, **kwargs)

                with (
                    patch.object(
                        startup.subprocess, "run", side_effect=fake_subprocess_run
                    ),
                    patch.object(PUBLIC.platform, "machine", return_value="x86_64"),
                ):
                    self.assertTrue(PUBLIC._prepare())
                summary = PUBLIC._load_summary()
                self.assertEqual(summary["schema"], "thunderbird-public-ics-summary@4")
                self.assertTrue(summary["startupArtifactsVerified"])
                self.assertIsNone(summary["startupArtifactsFailure"])
                self.assertTrue(summary["thunderbirdArchiveVerified"])
                self.assertTrue(summary["marionetteArtifactsVerified"])
                self.assertEqual(summary["nodeVersion"], NODE_VERSION)
                self.assertEqual(len(docker_calls), 2)
                run_args, run_kwargs = docker_calls[0]
                cleanup_args, _ = docker_calls[1]
                self.assertEqual(run_args[:2], ["docker", "run"])
                self.assertEqual(cleanup_args[1:4], ["container", "rm", "--force"])
                container_name = run_args[run_args.index("--name") + 1]
                self.assertRegex(container_name, r"^tbcal-17-1-[a-z0-9-]{1,16}$")
                self.assertTrue(container_name.endswith("-verify-pub-venv"))
                self.assertEqual(cleanup_args[4], container_name)
                self.assertLessEqual(len("verify-pub-venv"), 16)
                self.assertEqual(run_kwargs["timeout"], 30)
                self.assertIn("--platform=linux/amd64", run_args)
                self.assertIn("--network=none", run_args)
                self.assertIn("--read-only", run_args)
                self.assertIn("--cap-drop=ALL", run_args)
                self.assertIn("--security-opt=no-new-privileges", run_args)
                self.assertRegex(
                    run_args[run_args.index("--user") + 1], r"^[0-9]+:[0-9]+$"
                )
                container_environment = [
                    run_args[index + 1]
                    for index, argument in enumerate(run_args[:-1])
                    if argument == "-e"
                ]
                self.assertIn(f"HOME={environment['HOME']}", container_environment)
                self.assertEqual(run_args.count("--mount"), 2)
                mount_values = [
                    run_args[index + 1]
                    for index, argument in enumerate(run_args[:-1])
                    if argument == "--mount"
                ]
                venv_mounts = [
                    mount
                    for mount in mount_values
                    if mount.endswith("dst=/task/venv,readonly")
                ]
                self.assertEqual(len(venv_mounts), 1)
                probe_command = [
                    "/task/venv/bin/python",
                    "-B",
                    "-c",
                    "from marionette_driver.geckoinstance import apps; assert 'thunderbird' in apps",
                ]
                self.assertEqual(run_args[-len(probe_command) :], probe_command)
                self.assertEqual(
                    run_args[-len(probe_command) - 1], environment["TB_DOCKER_IMAGE"]
                )

                public_environment = PUBLIC._public_container_environment(SOURCE_SHA)
                self.assertNotIn("PRIVATE_CALDAV_CONTRACT", public_environment)
                self.assertFalse(
                    any(name.startswith("MCW_PRIVATE_") for name in public_environment)
                )
                self.assertEqual(
                    public_environment["MCW_PUBLIC_ICS_RESULT_FILE"],
                    "/task/workspace/public-feed-native-result.json",
                )

    def test_finalizer_rejects_skipped_run_and_closes_summary(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            runner_temp = base / "runner-temp"
            runner_temp.mkdir()
            task_parent = base / "task-roots"
            task_parent.mkdir()
            task_root = task_parent / "tb-calendar-smoke-17-1"
            self._write_owner_marker(task_root)
            environment = {
                "RUNNER_TEMP": str(runner_temp),
                "GITHUB_SHA": SOURCE_SHA,
                "GITHUB_RUN_ID": "17",
                "GITHUB_RUN_ATTEMPT": "1",
                **self._outcome_environment(),
                "TB_PUBLIC_RUN_OUTCOME": "skipped",
            }
            with (
                patch.dict(os.environ, environment),
                patch.object(PUBLIC.SMOKE, "ROOT_PARENT", task_parent),
            ):
                summary = self._summary()
                summary["status"] = "running"
                summary["feed_url"] = "fixture-capability"
                summary["event_text"] = "synthetic fixture detail"
                PUBLIC._write_summary(summary)
                self.assertFalse(PUBLIC._finalize())
                saved = PUBLIC._load_summary()
                self.assertEqual(saved["status"], "failed")
                self.assertEqual(saved["failure_stage"], "fixture_run")
                self.assertEqual(saved["failure_class"], "jest_failed")
                self.assertFalse(task_root.exists())
                self.assertEqual(set(saved), set(PUBLIC._initial_summary(SOURCE_SHA)))
                serialized = PUBLIC._summary_path().read_text(encoding="utf-8")
                self.assertNotIn("fixture-capability", serialized)
                self.assertNotIn("synthetic fixture detail", serialized)

    def test_finalizer_passes_only_with_native_gates_and_all_step_outcomes(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            runner_temp = base / "runner-temp"
            runner_temp.mkdir()
            task_parent = base / "task-roots"
            task_parent.mkdir()
            task_root = task_parent / "tb-calendar-smoke-17-1"
            self._write_owner_marker(task_root)
            environment = {
                "RUNNER_TEMP": str(runner_temp),
                "GITHUB_SHA": SOURCE_SHA,
                "GITHUB_RUN_ID": "17",
                "GITHUB_RUN_ATTEMPT": "1",
                **self._outcome_environment(),
            }
            with (
                patch.dict(os.environ, environment),
                patch.object(PUBLIC.SMOKE, "ROOT_PARENT", task_parent),
            ):
                summary = self._summary()
                summary["status"] = "running"
                PUBLIC._write_summary(summary)
                self.assertTrue(PUBLIC._finalize())
                saved = PUBLIC._load_summary()
                self.assertEqual(saved["status"], "passed")
                self.assertEqual(saved["phase"], "complete")
                self.assertFalse(task_root.exists())
                self.assertEqual(set(saved), set(PUBLIC._initial_summary(SOURCE_SHA)))


if __name__ == "__main__":
    unittest.main()
