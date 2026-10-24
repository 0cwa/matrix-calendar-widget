#!/usr/bin/env python3
"""Offline checks for the closed native Thunderbird public ICS profile."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import re
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


class PublicFeedSmokeTests(unittest.TestCase):
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

    def test_timeout_budget_orders_fixture_jest_container_and_workflow(self) -> None:
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
        fixture_ms = sum(fixture_values.values())
        self.assertEqual(fixture_ms, 783_000)
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

    def test_container_environment_rejects_private_or_extra_public_credentials(
        self,
    ) -> None:
        environment = {
            "MCW_PUBLIC_FEED_NATIVE_PROFILE": "1",
            **PUBLIC._public_container_environment(),
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

            environment = {
                "RUNNER_TEMP": str(runner_temp),
                "GITHUB_SHA": SOURCE_SHA,
                "GITHUB_RUN_ID": "17",
                "GITHUB_RUN_ATTEMPT": "1",
                "GITHUB_WORKSPACE": str(workspace),
                "RUNNER_TOOL_CACHE": str(tool_cache),
                "PATH": str(node.parent),
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

                with (
                    patch.object(
                        startup, "_capture_container", return_value=""
                    ) as probe,
                    patch.object(PUBLIC.platform, "machine", return_value="x86_64"),
                ):
                    self.assertTrue(PUBLIC._prepare())
                summary = PUBLIC._load_summary()
                self.assertTrue(summary["startupArtifactsVerified"])
                self.assertTrue(summary["thunderbirdArchiveVerified"])
                self.assertTrue(summary["marionetteArtifactsVerified"])
                self.assertEqual(summary["nodeVersion"], NODE_VERSION)
                self.assertEqual(probe.call_args.args[0], "verify-public-venv")
                self.assertEqual(
                    probe.call_args.kwargs["mounts"],
                    [(task_root / "venv", "/task/venv", True)],
                )

                public_environment = PUBLIC._public_container_environment()
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
