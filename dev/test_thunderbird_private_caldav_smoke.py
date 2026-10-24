#!/usr/bin/env python3
"""Offline checks for the closed native Thunderbird CalDAV runner."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("thunderbird-private-caldav-smoke.py")
SPEC = importlib.util.spec_from_file_location("private_caldav_smoke", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("private CalDAV smoke helper is unavailable")
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)


class PrivateCalDavSmokeTests(unittest.TestCase):
    def test_startup_artifacts_must_be_verified_for_this_source(self) -> None:
        startup = {
            "schema": "thunderbird-calendar-startup-smoke@6",
            "source_sha": "a" * 40,
            "status": "running",
            "phase": "dependency_install",
            "archive_sha256_verified": True,
            "archive_sha512_verified": True,
            "python_artifacts_verified": True,
            "docker_backend_verified": True,
            "docker_isolation_verified": True,
        }
        self.assertTrue(SMOKE._startup_artifacts_verified(startup, "a" * 40))
        startup["archive_sha512_verified"] = False
        self.assertFalse(SMOKE._startup_artifacts_verified(startup, "a" * 40))
        startup["archive_sha512_verified"] = True
        self.assertFalse(SMOKE._startup_artifacts_verified(startup, "b" * 40))

    def test_startup_artifact_paths_must_exist_under_owned_task_root(self) -> None:
        source_sha = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binary = root / "app" / "thunderbird" / "thunderbird"
            runtime = root / "venv" / "bin" / "python"
            marionette = (
                root
                / "venv"
                / "lib"
                / "python3.13"
                / "site-packages"
                / "marionette_driver"
                / "marionette.py"
            )
            for path in (binary, runtime, marionette):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("synthetic artifact", encoding="utf-8")
            summary = {
                "schema": "thunderbird-calendar-startup-smoke@6",
                "source_sha": source_sha,
                "status": "running",
                "phase": "dependency_install",
                "archive_sha256_verified": True,
                "archive_sha512_verified": True,
                "python_artifacts_verified": True,
                "docker_backend_verified": True,
                "docker_isolation_verified": True,
            }
            summary_path = root / "startup-summary.json"
            summary_path.write_text(json.dumps(summary), encoding="utf-8")
            summary_path.chmod(0o600)
            with patch.object(SMOKE.SMOKE, "_summary_path", return_value=summary_path):
                SMOKE._require_startup_artifacts(root, source_sha)
                marionette.unlink()
                with self.assertRaises(ValueError):
                    SMOKE._require_startup_artifacts(root, source_sha)

    def test_closed_native_result_requires_every_real_app_predicate(self) -> None:
        payload = {
            "schema": SMOKE.RESULT_SCHEMA,
            "status": "passed",
            "appVersion": "158.0.1",
            **{key: True for key in SMOKE.RESULT_FIELDS},
        }
        with tempfile.TemporaryDirectory() as temporary:
            result = Path(temporary) / SMOKE.RESULT_FILENAME
            result.write_text(json.dumps(payload), encoding="utf-8")
            result.chmod(0o600)
            self.assertEqual(SMOKE._read_native_result(result), payload)

            payload["canonicalCreateRoundtrip"] = False
            result.write_text(json.dumps(payload), encoding="utf-8")
            result.chmod(0o600)
            with self.assertRaises(ValueError):
                SMOKE._read_native_result(result)

    def test_closed_native_result_rejects_unexpected_fields(self) -> None:
        payload = {
            "schema": SMOKE.RESULT_SCHEMA,
            "status": "passed",
            "appVersion": "158.0.1",
            **{key: True for key in SMOKE.RESULT_FIELDS},
            "personal_secret": "must-not-be-accepted",
        }
        with tempfile.TemporaryDirectory() as temporary:
            result = Path(temporary) / SMOKE.RESULT_FILENAME
            result.write_text(json.dumps(payload), encoding="utf-8")
            result.chmod(0o600)
            with self.assertRaises(ValueError):
                SMOKE._read_native_result(result)

    def test_public_summary_drops_unrecognized_private_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with patch.dict(os.environ, {"RUNNER_TEMP": temporary}):
                payload = SMOKE._initial_summary("a" * 40)
                payload["personal_secret"] = "must-not-be-written"
                SMOKE._write_summary(payload)
                summary_path = Path(temporary) / "thunderbird-private-caldav-summary.json"
                observed = json.loads(summary_path.read_text(encoding="utf-8"))
                self.assertEqual(set(observed), set(SMOKE._initial_summary("a" * 40)))
                self.assertNotIn("must-not-be-written", summary_path.read_text())
                self.assertEqual(summary_path.stat().st_mode & 0o777, 0o600)

    def test_workspace_mount_is_read_only_and_exact(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary) / "checkout"
            workspace.mkdir()
            with patch.dict(os.environ, {"GITHUB_WORKSPACE": str(workspace)}):
                self.assertIn(
                    f"src={workspace.resolve()}",
                    SMOKE.SMOKE._container_mount(
                        workspace,
                        "/task/source",
                        readonly=True,
                        allow_workspace=True,
                    ),
                )
                with self.assertRaises(SMOKE.SMOKE.SmokeFailure):
                    SMOKE.SMOKE._container_mount(
                        workspace,
                        "/task/source",
                        readonly=False,
                        allow_workspace=True,
                    )
                with self.assertRaises(SMOKE.SMOKE.SmokeFailure):
                    SMOKE.SMOKE._container_mount(
                        workspace,
                        "/task/other",
                        readonly=True,
                        allow_workspace=True,
                    )

    def test_finalize_passes_only_after_all_steps_and_native_predicates(self) -> None:
        source_sha = "a" * 40
        complete = SMOKE._initial_summary(source_sha)
        complete.update(
            {
                "phase": "complete",
                "docker_backend_verified": True,
                "docker_isolation_verified": True,
                "thunderbird_archive_verified": True,
                "marionette_artifacts_verified": True,
                "node_version": "22.12.0",
                "caldav_wheels_verified": True,
                "caldav_wheel_count": SMOKE.EXPECTED_WHEEL_COUNT,
                "caldav_wheel_bytes": 1,
                "private_dependencies_installed": True,
                "native_provider_passed": True,
                "app_version": "158.0.1",
                **{key: True for key in SMOKE.RESULT_FIELDS},
            }
        )
        with tempfile.TemporaryDirectory() as temporary:
            task_root = Path(temporary) / "owned-task"
            task_root.mkdir()
            environment = {
                "RUNNER_TEMP": temporary,
                "GITHUB_SHA": source_sha,
                "GITHUB_RUN_ID": "12345",
                "GITHUB_RUN_ATTEMPT": "1",
                "TB_PRIVATE_IMAGE_OUTCOME": "success",
                "TB_PRIVATE_PREFLIGHT_OUTCOME": "success",
                "TB_PRIVATE_PREPARE_OUTCOME": "success",
                "TB_PRIVATE_INSTALL_OUTCOME": "success",
                "TB_PRIVATE_RUN_OUTCOME": "success",
            }
            with (
                patch.dict(os.environ, environment),
                patch.object(SMOKE, "_task_root", return_value=task_root),
                patch.object(SMOKE.SMOKE, "_cleanup_root"),
            ):
                SMOKE._write_summary(complete)
                SMOKE._finalize()
                passed = json.loads(
                    (Path(temporary) / "thunderbird-private-caldav-summary.json").read_text()
                )
                self.assertEqual(passed["status"], "passed")

                incomplete = dict(complete)
                incomplete["canonicalEditRoundtrip"] = False
                SMOKE._write_summary(incomplete)
                SMOKE._finalize()
                failed = json.loads(
                    (Path(temporary) / "thunderbird-private-caldav-summary.json").read_text()
                )
                self.assertEqual(failed["status"], "failed")
                self.assertEqual(failed["failure_class"], "internal_error")

                with patch.dict(
                    os.environ, {"TB_PRIVATE_RUN_OUTCOME": "skipped"}
                ):
                    SMOKE._write_summary(complete)
                    SMOKE._finalize()
                    skipped = json.loads(
                        (
                            Path(temporary)
                            / "thunderbird-private-caldav-summary.json"
                        ).read_text()
                    )
                    self.assertEqual(skipped["status"], "failed")
                    self.assertEqual(skipped["failure_class"], "jest_failed")


if __name__ == "__main__":
    unittest.main()
