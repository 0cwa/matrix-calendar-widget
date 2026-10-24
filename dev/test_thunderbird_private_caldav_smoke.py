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
    def _make_yarn_hoisted_workspace(self, workspace: Path) -> Path:
        workspace.mkdir()
        (workspace / "package.json").write_text(
            json.dumps(
                {
                    "name": "matrix-calendar-widget",
                    "packageManager": "yarn@1.22.22+sha1.ac34549e6aa8e7ead463a7407e1c7390f61a6610",
                    "workspaces": [
                        "matrix-calendar-widget",
                        "matrix-calendar-server",
                        "e2e",
                        "packages/*",
                    ],
                }
            ),
            encoding="utf-8",
        )
        jest_entry = workspace / "node_modules" / "jest" / "bin" / "jest.js"
        jest_entry.parent.mkdir(parents=True)
        jest_entry.write_text("// hoisted Jest package entry\n", encoding="utf-8")
        bin_directory = workspace / "node_modules" / ".bin"
        bin_directory.mkdir()
        jest_binary = bin_directory / "jest"
        jest_binary.symlink_to("../jest/bin/jest.js")
        return jest_entry

    def _produce_startup_artifacts(self, task_root: Path, source_sha: str) -> Path:
        startup = SMOKE.SMOKE
        preflight = startup._initial_summary(source_sha)
        preflight.update(
            {
                "docker_backend_verified": True,
                "docker_isolation_verified": True,
            }
        )
        startup._write_summary(preflight)

        def dummy_download(
            _artifact: dict,
            destination: Path,
            _expected_host: str,
            **_kwargs: object,
        ) -> None:
            destination.write_bytes(b"temporary dummy download")

        def dummy_extract(_archive_path: Path, destination: Path) -> Path:
            binary = destination / "thunderbird" / "thunderbird"
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b"temporary dummy Thunderbird binary")
            binary.chmod(0o700)
            return binary

        def dummy_install(_root: Path, _packages: list[dict]) -> None:
            runtime = _root / "venv" / "bin" / "python"
            runtime.parent.mkdir(parents=True)
            runtime.symlink_to("/usr/local/bin/python3.13")
            marionette = (
                _root
                / "venv"
                / "lib"
                / "python3.13"
                / "site-packages"
                / "marionette_driver"
                / "marionette.py"
            )
            marionette.parent.mkdir(parents=True)
            marionette.write_text("# temporary fixture\n", encoding="utf-8")

        payload = startup._initial_summary(source_sha)
        with (
            patch.object(startup, "_download", side_effect=dummy_download),
            patch.object(startup, "_safe_extract", side_effect=dummy_extract),
            patch.object(startup, "_install_dependencies", side_effect=dummy_install),
        ):
            startup._prepare(payload, source_sha, task_root, startup._load_lock())
        startup._write_summary(payload)
        return startup._summary_path()

    def test_actual_startup_prepare_output_matches_workspace_and_artifact_gates(self) -> None:
        source_sha = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            temporary_path = Path(temporary)
            runner_temp = temporary_path / "runner-temp"
            runner_temp.mkdir()
            task_root = temporary_path / "task-root"
            workspace = temporary_path / "workspace"
            jest_entry = self._make_yarn_hoisted_workspace(workspace)
            environment = {
                "RUNNER_TEMP": str(runner_temp),
                "GITHUB_SHA": source_sha,
                "GITHUB_WORKSPACE": str(workspace),
            }
            with patch.dict(os.environ, environment):
                summary_path = self._produce_startup_artifacts(task_root, source_sha)
                startup_summary = json.loads(summary_path.read_text(encoding="utf-8"))
                self.assertEqual(
                    startup_summary["schema"], "thunderbird-calendar-startup-smoke@6"
                )
                self.assertEqual(startup_summary["status"], "running")
                self.assertEqual(startup_summary["phase"], "dependency_install")
                self.assertEqual(startup_summary["source_sha"], source_sha)
                self.assertTrue(
                    all(
                        startup_summary[key] is True
                        for key in (
                            "archive_sha256_verified",
                            "archive_sha512_verified",
                            "python_artifacts_verified",
                            "docker_backend_verified",
                            "docker_isolation_verified",
                        )
                    )
                )
                self.assertTrue(SMOKE._startup_artifacts_verified(startup_summary, source_sha))
                self.assertFalse(
                    SMOKE._startup_artifacts_verified(startup_summary, "b" * 40)
                )

                binary = task_root / "app" / "thunderbird" / "thunderbird"
                runtime = task_root / "venv" / "bin" / "python"
                marionette = (
                    task_root
                    / "venv"
                    / "lib"
                    / "python3.13"
                    / "site-packages"
                    / "marionette_driver"
                    / "marionette.py"
                )
                startup = SMOKE.SMOKE
                self.assertTrue(binary.is_file())
                self.assertFalse(binary.is_symlink())
                self.assertTrue(runtime.is_symlink())
                self.assertFalse(runtime.exists())
                self.assertTrue(marionette.is_file())
                self.assertFalse(marionette.is_symlink())
                self.assertTrue(jest_entry.is_file())
                self.assertTrue((workspace / "node_modules" / ".bin" / "jest").is_symlink())
                self.assertTrue((workspace / "node_modules" / ".bin" / "jest").is_file())

                with patch.object(startup, "_capture_container", return_value="") as probe:
                    SMOKE._require_startup_artifacts(task_root, source_sha)
                self.assertEqual(
                    probe.call_args.args,
                    (
                        "verify-venv",
                        [
                            "/task/venv/bin/python",
                            "-B",
                            "-c",
                            "from marionette_driver.geckoinstance import apps; assert 'thunderbird' in apps",
                        ],
                    ),
                )
                self.assertEqual(
                    probe.call_args.kwargs["mounts"],
                    [(task_root / "venv", "/task/venv", True)],
                )
                self.assertEqual(probe.call_args.kwargs["timeout"], 30)

                with patch.object(
                    startup,
                    "_capture_container",
                    side_effect=startup.SmokeFailure("preflight", "invalid_input"),
                ):
                    with self.assertRaises(ValueError):
                        SMOKE._require_startup_artifacts(task_root, source_sha)

                runtime.unlink()
                with self.assertRaises(ValueError):
                    SMOKE._require_startup_artifacts(task_root, source_sha)
                runtime.write_text("not an interpreter link\n", encoding="utf-8")
                with self.assertRaises(ValueError):
                    SMOKE._require_startup_artifacts(task_root, source_sha)
                runtime.unlink()
                runtime.symlink_to("/usr/local/bin/python3.13")

                binary.unlink()
                with self.assertRaises(ValueError):
                    SMOKE._require_startup_artifacts(task_root, source_sha)
                binary.write_bytes(b"temporary dummy Thunderbird binary")
                binary.chmod(0o700)
                binary_target = binary.with_name("thunderbird-copy")
                binary_target.write_bytes(b"temporary dummy Thunderbird binary")
                binary.unlink()
                binary.symlink_to(binary_target)
                with self.assertRaises(ValueError):
                    SMOKE._require_startup_artifacts(task_root, source_sha)
                binary.unlink()
                binary_target.unlink()
                binary.write_bytes(b"temporary dummy Thunderbird binary")
                binary.chmod(0o700)

                self.assertEqual(SMOKE._workspace(), workspace.resolve())
                with (
                    patch.object(startup, "ROOT_PARENT", task_root.parent),
                    patch.object(startup, "_root_path", return_value=task_root),
                    patch.object(SMOKE, "_task_root", return_value=task_root),
                    patch.object(
                        SMOKE,
                        "_node_runtime",
                        return_value=("22.23.3", task_root / "node"),
                    ),
                    patch.object(
                        SMOKE,
                        "_download_private_wheels",
                        return_value=(SMOKE.EXPECTED_WHEEL_COUNT, 1000),
                    ),
                    patch.object(startup, "_capture_container", return_value=""),
                ):
                    SMOKE._prepare()
                    _, prepared = SMOKE._require_prepared(source_sha)
                self.assertTrue(prepared["workspace_jest_ready"])
                self.assertTrue(prepared["startup_artifacts_verified"])

                marionette.unlink()
                with self.assertRaises(ValueError):
                    SMOKE._require_startup_artifacts(task_root, source_sha)
                marionette.write_text("# temporary fixture target\n", encoding="utf-8")
                marionette_target = marionette.with_name("marionette-copy.py")
                marionette.rename(marionette_target)
                marionette.symlink_to(marionette_target)
                with self.assertRaises(ValueError):
                    SMOKE._require_startup_artifacts(task_root, source_sha)
                jest_entry.unlink()
                with self.assertRaises(ValueError):
                    SMOKE._workspace()

    def test_prepare_summary_identifies_which_preflight_gate_failed(self) -> None:
        source_sha = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            temporary_path = Path(temporary)
            runner_temp = temporary_path / "runner-temp"
            runner_temp.mkdir()
            task_root = temporary_path / "task-root"
            workspace = temporary_path / "workspace"
            self._make_yarn_hoisted_workspace(workspace)
            environment = {
                "RUNNER_TEMP": str(runner_temp),
                "GITHUB_SHA": source_sha,
                "GITHUB_WORKSPACE": str(workspace),
            }
            with patch.dict(os.environ, environment):
                self._produce_startup_artifacts(task_root, source_sha)
                startup = SMOKE.SMOKE
                with (
                    patch.object(startup, "ROOT_PARENT", task_root.parent),
                    patch.object(startup, "_root_path", return_value=task_root),
                    patch.object(SMOKE, "_workspace", side_effect=ValueError),
                    self.assertRaises(ValueError),
                ):
                    SMOKE._prepare()
                summary_path = runner_temp / "thunderbird-private-caldav-summary.json"
                workspace_failure = json.loads(summary_path.read_text(encoding="utf-8"))
                self.assertEqual(
                    workspace_failure["failure_class"], "workspace_preflight_failed"
                )
                self.assertFalse(workspace_failure["workspace_jest_ready"])
                self.assertFalse(workspace_failure["startup_artifacts_verified"])

                with (
                    patch.object(startup, "ROOT_PARENT", task_root.parent),
                    patch.object(startup, "_root_path", return_value=task_root),
                    patch.object(SMOKE, "_workspace", return_value=workspace.resolve()),
                    patch.object(
                        startup,
                        "_capture_container",
                        side_effect=startup.SmokeFailure("preflight", "invalid_input"),
                    ),
                    self.assertRaises(ValueError),
                ):
                    SMOKE._prepare()
                startup_failure = json.loads(summary_path.read_text(encoding="utf-8"))
                self.assertEqual(
                    startup_failure["failure_class"],
                    "startup_artifacts_preflight_failed",
                )
                self.assertTrue(startup_failure["workspace_jest_ready"])
                self.assertFalse(startup_failure["startup_artifacts_verified"])

                with (
                    patch.object(SMOKE, "_task_root", return_value=task_root),
                    patch.object(startup, "_cleanup_root"),
                ):
                    SMOKE._finalize()
                finalized = json.loads(summary_path.read_text(encoding="utf-8"))
                self.assertEqual(
                    finalized["failure_class"],
                    "startup_artifacts_preflight_failed",
                )

    def test_closed_native_result_requires_every_real_app_predicate(self) -> None:
        self.assertEqual(
            SMOKE.RESULT_SCHEMA, "thunderbird-private-caldav-qualification@1"
        )
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
                self.assertEqual(observed["schema"], "thunderbird-private-caldav-summary@2")
                self.assertNotIn("must-not-be-written", summary_path.read_text())
                self.assertEqual(summary_path.stat().st_mode & 0o777, 0o600)

    def test_summary_accepts_only_fixed_preflight_failure_classes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with patch.dict(os.environ, {"RUNNER_TEMP": temporary}):
                for failure_class in (
                    "workspace_preflight_failed",
                    "startup_artifacts_preflight_failed",
                ):
                    payload = SMOKE._initial_summary("a" * 40)
                    payload.update(
                        {
                            "status": "failed",
                            "phase": "prepare",
                            "failure_class": failure_class,
                        }
                    )
                    SMOKE._write_summary(payload)
                    summary_path = Path(temporary) / "thunderbird-private-caldav-summary.json"
                    observed = json.loads(summary_path.read_text(encoding="utf-8"))
                    self.assertEqual(observed["failure_class"], failure_class)

                payload["failure_class"] = "private path or error text"
                SMOKE._write_summary(payload)
                rejected = json.loads(summary_path.read_text(encoding="utf-8"))
                self.assertEqual(rejected["failure_class"], "internal_error")
                self.assertNotIn("private path or error text", summary_path.read_text())

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
                "workspace_jest_ready": True,
                "startup_artifacts_verified": True,
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

                incomplete_preflight = dict(complete)
                incomplete_preflight["workspace_jest_ready"] = False
                SMOKE._write_summary(incomplete_preflight)
                SMOKE._finalize()
                failed_preflight = json.loads(
                    (
                        Path(temporary)
                        / "thunderbird-private-caldav-summary.json"
                    ).read_text()
                )
                self.assertEqual(failed_preflight["status"], "failed")
                self.assertEqual(failed_preflight["failure_class"], "internal_error")

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
