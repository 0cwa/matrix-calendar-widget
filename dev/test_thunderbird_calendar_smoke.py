#!/usr/bin/env python3
"""Exercise closed Thunderbird startup diagnostics without launching the app."""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("thunderbird-calendar-smoke.py")
SPEC = importlib.util.spec_from_file_location("thunderbird_calendar_smoke", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load smoke script")
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)

PRIVATE_MESSAGE = "PRIVATE-EXCEPTION-MESSAGE /private/profile/path"


class FakeSocket:
    def __enter__(self) -> FakeSocket:
        return self

    def __exit__(self, *_args: object) -> bool:
        return False


class FakeChildProcess:
    def poll(self) -> int:
        return 23


class ConstructorFailure:
    def __init__(self, **_kwargs: object):
        raise FileNotFoundError(PRIVATE_MESSAGE)


class SessionFailure:
    CONTEXT_CHROME = "chrome"
    host = "localhost"
    port = 2828
    session = None

    def __init__(self, workspace: str, **_kwargs: object):
        self.profile_path = str(Path(workspace) / "private-profile")
        self.instance = types.SimpleNamespace(
            runner=types.SimpleNamespace(
                process_handler=types.SimpleNamespace(proc=FakeChildProcess())
            )
        )

    def start_session(self) -> None:
        raise ConnectionError(PRIVATE_MESSAGE)

    def cleanup(self) -> None:
        pass


class ThunderbirdSmokeDiagnosticTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="tb-smoke-diagnostic-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.task_root = self.base / "task"
        (self.task_root / "workspace").mkdir(parents=True)
        self.runtime_dir = self.base / "runtime"
        self.runtime_dir.mkdir()

    def _run_worker(self, marionette_class: type, *, port_ready: bool) -> dict[str, object]:
        package = types.ModuleType("marionette_driver")
        package.__path__ = []
        module = types.ModuleType("marionette_driver.marionette")
        module.Marionette = marionette_class
        completed = subprocess.CompletedProcess(
            ["thunderbird", "--version"],
            0,
            stdout="Mozilla Thunderbird 158.0.1\n",
        )
        environment = {
            "XDG_RUNTIME_DIR": str(self.runtime_dir),
            "RUNNER_TEMP": str(self.base),
        }
        with (
            patch.object(SMOKE, "CONTAINER_TASK_ROOT", self.task_root),
            patch.object(SMOKE, "CONTAINER_RUNTIME_DIR", self.runtime_dir),
            patch.dict(os.environ, environment),
            patch.dict(
                sys.modules,
                {
                    "marionette_driver": package,
                    "marionette_driver.marionette": module,
                },
            ),
            patch.object(SMOKE.subprocess, "run", return_value=completed),
            patch.object(SMOKE.socket, "create_connection", return_value=FakeSocket()),
        ):
            self.assertEqual(SMOKE._smoke_worker(self.task_root), 1)
            result_path = SMOKE._worker_result_path(self.task_root)
            self.assertTrue(result_path.is_file())
            self.assertEqual(result_path.stat().st_mode & 0o777, 0o600)
            self.assertTrue((self.task_root / "workspace/.xdg/state").is_dir())
            result = SMOKE._read_worker_result(self.task_root)
            self.assertEqual(result["marionette_port_ready"], port_ready)
            payload = SMOKE._initial_summary("a" * 40)
            payload.update(status="failed", phase="startup", error_class=result["error_class"])
            payload.update({key: result[key] for key in payload if key in result})
            SMOKE._write_summary(payload)
            summary_path = self.base / "thunderbird-calendar-smoke-summary.json"
            summary_text = summary_path.read_text(encoding="utf-8")
            summary = json.loads(summary_text)
            self.assertEqual(summary["schema"], "thunderbird-calendar-startup-smoke@5")
            self.assertEqual(summary["startup_stage"], result["startup_stage"])
            self.assertEqual(
                summary["startup_exception_class"], result["startup_exception_class"]
            )
            self.assertEqual(summary["binary_version"], "158.0.1")
            self.assertNotIn(PRIVATE_MESSAGE, result_path.read_text(encoding="utf-8"))
            self.assertNotIn(PRIVATE_MESSAGE, summary_text)
            self.assertNotIn(str(self.task_root), summary_text)
            self.assertNotIn("private-profile", summary_text)
            return result

    def test_constructor_failure_emits_closed_worker_result_after_xdg_setup(self) -> None:
        result = self._run_worker(ConstructorFailure, port_ready=False)
        self.assertEqual(result["startup_stage"], "marionette_constructor")
        self.assertEqual(result["startup_exception_class"], "FileNotFoundError")
        self.assertEqual(result["binary_version_probe"], "passed")
        self.assertFalse(result["marionette_session_created"])
        self.assertEqual(result["child_state"], "unknown")

    def test_session_failure_reports_port_and_available_child_state(self) -> None:
        result = self._run_worker(SessionFailure, port_ready=True)
        self.assertEqual(result["startup_stage"], "session_creation")
        self.assertEqual(result["startup_exception_class"], "ConnectionError")
        self.assertTrue(result["marionette_port_ready"])
        self.assertFalse(result["marionette_session_created"])
        self.assertEqual(result["child_state"], "exited")
        self.assertEqual(result["child_exit_code"], 23)

    def test_nonzero_version_probe_emits_redacted_bounded_artifact_before_cleanup(
        self,
    ) -> None:
        stderr = (
            b"libmoz.so: cannot load /private/build/profile/libmoz.so "
            b"from https://example.invalid/private?token=hidden\x1b[31m\x00\n"
            + b"x" * 4096
        )
        completed = subprocess.CompletedProcess(
            ["thunderbird", "--version"], 255, stdout="", stderr=stderr
        )
        environment = {
            "XDG_RUNTIME_DIR": str(self.runtime_dir),
            "RUNNER_TEMP": str(self.base),
        }
        with (
            patch.object(SMOKE, "CONTAINER_TASK_ROOT", self.task_root),
            patch.object(SMOKE, "CONTAINER_RUNTIME_DIR", self.runtime_dir),
            patch.dict(os.environ, environment),
            patch.object(SMOKE.subprocess, "run", return_value=completed),
        ):
            self.assertEqual(SMOKE._smoke_worker(self.task_root), 1)
            result = SMOKE._read_worker_result(self.task_root)
            self.assertEqual(result["binary_version_probe"], "nonzero_exit")
            worker_diagnostic = SMOKE._worker_startup_diagnostic_path(self.task_root)
            self.assertTrue(worker_diagnostic.is_file())
            self.assertLessEqual(
                worker_diagnostic.stat().st_size,
                SMOKE.MAX_STARTUP_DIAGNOSTIC_BYTES + 1,
            )
            SMOKE._persist_worker_startup_diagnostic(self.task_root, result)

        host_diagnostic = self.base / SMOKE.HOST_STARTUP_DIAGNOSTIC
        self.assertTrue(host_diagnostic.is_file())
        self.assertEqual(host_diagnostic.stat().st_mode & 0o777, 0o600)
        safe_text = host_diagnostic.read_text(encoding="utf-8")
        self.assertIn("libmoz.so: cannot load", safe_text)
        self.assertIn("[redacted-path]", safe_text)
        self.assertIn("[redacted-url]", safe_text)
        self.assertNotIn("/private/build/profile", safe_text)
        self.assertNotIn("https://example.invalid", safe_text)
        self.assertNotIn("token=hidden", safe_text)
        self.assertNotIn("\x1b", safe_text)
        self.assertNotIn("\x00", safe_text)
        self.assertLessEqual(
            len(safe_text.encode("utf-8")),
            SMOKE.MAX_STARTUP_DIAGNOSTIC_BYTES + 1,
        )

        shutil.rmtree(self.task_root)
        self.assertTrue(host_diagnostic.is_file())

    def test_successful_version_probe_creates_no_startup_diagnostic_artifact(
        self,
    ) -> None:
        result = self._run_worker(ConstructorFailure, port_ready=False)
        self.assertEqual(result["binary_version_probe"], "passed")
        SMOKE._persist_worker_startup_diagnostic(self.task_root, result)
        self.assertFalse(SMOKE._worker_startup_diagnostic_path(self.task_root).exists())
        self.assertFalse((self.base / SMOKE.HOST_STARTUP_DIAGNOSTIC).exists())


if __name__ == "__main__":
    unittest.main()
