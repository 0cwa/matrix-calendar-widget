#!/usr/bin/env python3
"""Offline checks for the closed native Thunderbird CalDAV runner."""

from __future__ import annotations

import ast
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("thunderbird-private-caldav-smoke.py")
CONTRACT_SCRIPT = (
    Path(__file__).parents[1]
    / "radicale-auth"
    / "tests"
    / "private_client_caldav_contract.py"
)
NATIVE_THUNDERBIRD_CONTRACT = (
    Path(__file__).parents[1]
    / "radicale-auth"
    / "tests"
    / "private_client_thunderbird_contract.py"
)
RADICALE_DOCKERFILE = Path(__file__).parents[1] / "radicale-auth" / "Dockerfile"
CALLBACK_MODULE_SOURCE = (
    Path(__file__).parents[1]
    / "radicale-auth"
    / "src"
    / "matrix_calendar_private_client_callback.py"
)
PRIVATE_CALDAV_REQUIREMENTS = Path(__file__).with_name(
    "thunderbird-private-caldav-requirements.txt"
)
SPEC = importlib.util.spec_from_file_location("private_caldav_smoke", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("private CalDAV smoke helper is unavailable")
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)


class PrivateCalDavSmokeTests(unittest.TestCase):
    def _load_native_thunderbird_contract(self):
        environment = {
            "MCW_PRIVATE_CALDAV_API_ORIGIN": "https://localhost:8443",
            "MCW_PRIVATE_CALDAV_CONTROL_PORT": "4242",
            "MCW_PRIVATE_CALDAV_CONTROL_KEY": "test-only-control-key",
            "MCW_PRIVATE_CALDAV_PERSONAL_APP_ID": "mcwpc~" + "a" * 48,
            "MCW_PRIVATE_CALDAV_PERSONAL_SECRET": "test-only-personal-secret",
            "MCW_PRIVATE_CALDAV_CA_FILE": "/tmp/test-only-ca.pem",
            "MCW_PRIVATE_CALDAV_NATIVE_THUNDERBIRD_BIN": (
                "/task/app/thunderbird/thunderbird"
            ),
            "MCW_PRIVATE_CALDAV_NATIVE_WORKSPACE": "/task/workspace",
        }
        with patch.dict(os.environ, environment):
            spec = importlib.util.spec_from_file_location(
                "private_client_thunderbird_contract_test",
                NATIVE_THUNDERBIRD_CONTRACT,
            )
            if spec is None or spec.loader is None:
                raise RuntimeError("private Thunderbird contract is unavailable")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        return module

    def test_radicale_image_copies_dependency_light_callback_module(self) -> None:
        dockerfile = RADICALE_DOCKERFILE.read_text(encoding="utf-8")
        self.assertTrue(CALLBACK_MODULE_SOURCE.is_file())
        self.assertIn(
            "src/matrix_calendar_private_client_callback.py",
            dockerfile,
        )
        self.assertIn(
            "/opt/radicale-auth/src/matrix_calendar_private_client_callback.py",
            dockerfile,
        )

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

    def _make_private_wheelhouse(self, task_root: Path) -> tuple[int, int]:
        wheelhouse = task_root / "private-caldav-wheels"
        wheelhouse.mkdir(mode=0o700)
        return SMOKE.EXPECTED_WHEEL_COUNT, 1000

    def _write_caldav_contract_diagnostic(
        self, path: Path, payload: dict[str, object]
    ) -> None:
        path.write_text(json.dumps(payload), encoding="utf-8")
        path.chmod(0o600)

    def test_python_contract_phase_markers_match_the_closed_enum(self) -> None:
        source = CONTRACT_SCRIPT.read_text(encoding="utf-8")
        tree = ast.parse(source)
        phase_assignment = next(
            node
            for node in tree.body
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name) and target.id == "CONTRACT_PHASES"
                for target in node.targets
            )
        )
        producer_phases = {
            element.value
            for element in phase_assignment.value.elts  # type: ignore[attr-defined]
            if isinstance(element, ast.Constant) and isinstance(element.value, str)
        }
        observed = set(re.findall(r'_set_contract_phase\("([a-z_]+)"\)', source))
        self.assertEqual(producer_phases, SMOKE.CALDAV_CONTRACT_PHASES)
        self.assertEqual(observed, SMOKE.CALDAV_CONTRACT_PHASES - {"setup"})
        self.assertIn('CURRENT_CONTRACT_PHASE = "setup"', source)
        self.assertIn("os.O_EXCL | getattr(os, \"O_NOFOLLOW\", 0)", source)
        self.assertIn("            0o600,", source)
        setup_boundaries = (
            ("caldav_imports", "import caldav"),
            (
                "callback_imports",
                "from matrix_calendar_private_client_callback import",
            ),
            (
                "env_port_validation",
                'RADICALE_PORT = int(os.environ["MCW_PRIVATE_CALDAV_RADICALE_PORT"])',
            ),
            ("callback_key_decode", "CALLBACK_KEY = base64.urlsafe_b64decode("),
            ("url_parse", "API = urllib.parse.urlsplit(API_ORIGIN)"),
            (
                "ca_context",
                "TLS_CONTEXT = ssl.create_default_context(",
            ),
        )
        for phase, operation in setup_boundaries:
            with self.subTest(phase=phase):
                self.assertLess(
                    source.index(f'_set_contract_phase("{phase}")'),
                    source.index(operation),
                )

    def test_python_setup_error_classes_are_fixed_and_unknown_modules_are_hidden(
        self,
    ) -> None:
        import ssl

        source_tree = ast.parse(CONTRACT_SCRIPT.read_text(encoding="utf-8"))
        allowlist = next(
            node
            for node in source_tree.body
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name)
                and target.id == "KNOWN_SETUP_IMPORT_MODULES"
                for target in node.targets
            )
        )
        classifier = next(
            node
            for node in source_tree.body
            if isinstance(node, ast.FunctionDef)
            and node.name == "_classify_setup_exception"
        )
        isolated = ast.Module(body=[allowlist, classifier], type_ignores=[])
        namespace: dict[str, object] = {"ssl": ssl}
        exec(
            compile(
                ast.fix_missing_locations(isolated), str(CONTRACT_SCRIPT), "exec"
            ),
            namespace,
        )
        classify = namespace["_classify_setup_exception"]

        cases = (
            (
                "caldav_imports",
                ModuleNotFoundError("private message", name="caldav.lib.error"),
                "module_missing",
            ),
            (
                "callback_imports",
                ModuleNotFoundError(
                    "private message", name="matrix_calendar_private_client_callback"
                ),
                "module_missing",
            ),
            ("callback_imports", ImportError("private message"), "import_error"),
            (
                "env_port_validation",
                KeyError("private environment name"),
                "missing_environment",
            ),
            ("env_port_validation", ValueError("private port value"), "invalid_value"),
            ("callback_key_decode", ValueError("private key value"), "invalid_value"),
            ("url_parse", ValueError("private URL value"), "invalid_value"),
            (
                "ca_context",
                ssl.SSLError("private certificate message"),
                "tls_setup",
            ),
            ("ca_context", RuntimeError("private exception text"), "other"),
            (
                "caldav_imports",
                ModuleNotFoundError(
                    "secret module name", name="unlisted_secret_module"
                ),
                "other",
            ),
        )
        for phase, error, expected in cases:
            with self.subTest(phase=phase, expected=expected):
                observed = classify(phase, error)
                self.assertEqual(observed, expected)
                self.assertIn(observed, SMOKE.CALDAV_CONTRACT_ERROR_CLASSES)
                self.assertNotIn(str(error), observed)

        locked_distribution_modules = {
            "caldav": "caldav",
            "charset-normalizer": "charset_normalizer",
            "click": "click",
            "dnspython": "dns",
            "h11": "h11",
            "icalendar": "icalendar",
            "icalendar-searcher": "icalendar_searcher",
            "jh2": "jh2",
            "lxml": "lxml",
            "niquests": "niquests",
            "python-dateutil": "dateutil",
            "pyyaml": "yaml",
            "qh3": "qh3",
            "recurring-ical-events": "recurring_ical_events",
            "six": "six",
            "tzdata": "tzdata",
            "urllib3-future": "urllib3_future",
            "wassima": "wassima",
            "x-wr-timezone": "x_wr_timezone",
        }
        locked_distributions = {
            line.split("==", 1)[0].lower()
            for line in PRIVATE_CALDAV_REQUIREMENTS.read_text(
                encoding="utf-8"
            ).splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }
        self.assertEqual(set(locked_distribution_modules), locked_distributions)
        self.assertTrue(
            set(locked_distribution_modules.values()).issubset(
                namespace["KNOWN_SETUP_IMPORT_MODULES"]
            )
        )

    def test_python_contract_diagnostic_accepts_fixed_phases_and_classes(self) -> None:
        source_sha = "a" * 40
        cases = (
            ("caldav_imports", "module_missing", "python_contract_caldav_imports"),
            ("callback_imports", "import_error", "python_contract_callback_imports"),
            (
                "env_port_validation",
                "missing_environment",
                "python_contract_env_port_validation",
            ),
            (
                "callback_key_decode",
                "invalid_value",
                "python_contract_callback_key_decode",
            ),
            ("url_parse", "invalid_value", "python_contract_url_parse"),
            ("ca_context", "tls_setup", "python_contract_ca_context"),
            ("callback_security", "operation_failed", "python_contract_callback_security"),
            ("event_read", "assertion_failed", "python_contract_event_read"),
            ("setup", "setup_failed", "python_contract_setup"),
        )
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / SMOKE.CALDAV_CONTRACT_DIAGNOSTIC_FILENAME
            for phase, error_class, expected_stage in cases:
                with self.subTest(phase=phase, error_class=error_class):
                    self._write_caldav_contract_diagnostic(
                        path,
                        {
                            "schema": SMOKE.CALDAV_CONTRACT_DIAGNOSTIC_SCHEMA,
                            "status": "failed",
                            "source_sha": source_sha,
                            "phase": phase,
                            "error_class": error_class,
                        },
                    )
                    self.assertEqual(
                        SMOKE._read_caldav_contract_diagnostic(path, source_sha),
                        {
                            "fixture_failure_stage": expected_stage,
                            "fixture_failure_class": (
                                SMOKE.CALDAV_CONTRACT_SUMMARY_CLASSES[error_class]
                            ),
                        },
                    )
                    path.unlink()

    def test_python_contract_diagnostic_only_refines_failed_contract_setup(self) -> None:
        diagnostic = {
            "fixture_failure_stage": "python_contract_event_read",
            "fixture_failure_class": "python_contract_assertion_failed",
        }
        self.assertEqual(
            SMOKE._project_caldav_contract_diagnostic(
                "fixture_setup", "caldav_contract_failed", diagnostic
            ),
            ("python_contract_event_read", "python_contract_assertion_failed"),
        )
        self.assertEqual(
            SMOKE._project_caldav_contract_diagnostic(
                "suite_load", "jest_suite_failed", diagnostic
            ),
            ("suite_load", "jest_suite_failed"),
        )
        self.assertEqual(
            SMOKE._project_caldav_contract_diagnostic(
                "fixture_setup", "caldav_contract_failed", None
            ),
            ("fixture_setup", "caldav_contract_failed"),
        )
        self.assertEqual(
            SMOKE._project_caldav_contract_diagnostic(
                "fixture_setup",
                "caldav_contract_failed",
                {
                    "fixture_failure_stage": "private value",
                    "fixture_failure_class": "private value",
                },
            ),
            ("fixture_setup", "caldav_contract_failed"),
        )

    def test_python_contract_diagnostic_rejects_malformed_stale_and_unknown_data(self) -> None:
        source_sha = "a" * 40
        valid = {
            "schema": SMOKE.CALDAV_CONTRACT_DIAGNOSTIC_SCHEMA,
            "status": "failed",
            "source_sha": source_sha,
            "phase": "event_read",
            "error_class": "assertion_failed",
        }
        bad_values = (
            {**valid, "source_sha": "b" * 40},
            {**valid, "phase": "unknown_phase"},
            {**valid, "error_class": "private error text"},
            {**valid, "raw_message": "must never be projected"},
        )
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / SMOKE.CALDAV_CONTRACT_DIAGNOSTIC_FILENAME
            for value in bad_values:
                with self.subTest(value_keys=tuple(sorted(value))):
                    self._write_caldav_contract_diagnostic(path, value)
                    self.assertIsNone(
                        SMOKE._read_caldav_contract_diagnostic(path, source_sha)
                    )
                    path.unlink()

            path.write_text('{"phase":"event_read","phase":"event_read"}', encoding="utf-8")
            path.chmod(0o600)
            self.assertIsNone(
                SMOKE._read_caldav_contract_diagnostic(path, source_sha)
            )
            path.unlink()

            path.write_text("{", encoding="utf-8")
            path.chmod(0o600)
            self.assertIsNone(
                SMOKE._read_caldav_contract_diagnostic(path, source_sha)
            )
            path.unlink()

            self._write_caldav_contract_diagnostic(path, valid)
            path.chmod(0o640)
            self.assertIsNone(
                SMOKE._read_caldav_contract_diagnostic(path, source_sha)
            )
            path.unlink()

            path.write_bytes(b"x" * (SMOKE.MAX_CALDAV_CONTRACT_DIAGNOSTIC_BYTES + 1))
            path.chmod(0o600)
            self.assertIsNone(
                SMOKE._read_caldav_contract_diagnostic(path, source_sha)
            )
            path.unlink()

            target = Path(temporary) / "target.json"
            self._write_caldav_contract_diagnostic(target, valid)
            path.symlink_to(target)
            self.assertIsNone(
                SMOKE._read_caldav_contract_diagnostic(path, source_sha)
            )
            SMOKE._remove_caldav_contract_diagnostic(path)
            self.assertTrue(path.is_symlink())
            path.unlink()

    def test_python_contract_diagnostic_cleanup_removes_only_owned_private_regular_file(self) -> None:
        source_sha = "a" * 40
        payload = {
            "schema": SMOKE.CALDAV_CONTRACT_DIAGNOSTIC_SCHEMA,
            "status": "failed",
            "source_sha": source_sha,
            "phase": "event_read",
            "error_class": "assertion_failed",
        }
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / SMOKE.CALDAV_CONTRACT_DIAGNOSTIC_FILENAME
            self._write_caldav_contract_diagnostic(path, payload)
            SMOKE._remove_caldav_contract_diagnostic(path)
            self.assertFalse(path.exists())
            SMOKE._remove_caldav_contract_diagnostic(path)

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
                        side_effect=self._make_private_wheelhouse,
                    ),
                    patch.object(startup, "_capture_container", return_value=""),
                ):
                    SMOKE._prepare()
                    _, prepared = SMOKE._require_prepared(source_sha)
                self.assertTrue(prepared["workspace_jest_ready"])
                self.assertTrue(prepared["startup_artifacts_verified"])

                with (
                    patch.object(startup, "ROOT_PARENT", task_root.parent),
                    patch.object(startup, "_root_path", return_value=task_root),
                    patch.object(SMOKE, "_task_root", return_value=task_root),
                    patch.object(
                        startup, "_run_container_bounded", return_value=1
                    ) as failed_install,
                    self.assertRaises(ValueError),
                ):
                    SMOKE._install()
                failed_summary = SMOKE._load_summary()
                self.assertEqual(failed_summary["failure_class"], "dependency_install_failed")
                self.assertEqual(failed_summary["phase"], "dependency_install")
                self.assertFalse(failed_summary["private_dependencies_installed"])
                failed_install.assert_called_once()

                SMOKE._write_summary(prepared)
                with (
                    patch.object(startup, "ROOT_PARENT", task_root.parent),
                    patch.object(startup, "_root_path", return_value=task_root),
                    patch.object(SMOKE, "_task_root", return_value=task_root),
                    patch.object(
                        startup, "_run_container_bounded", return_value=0
                    ) as install,
                ):
                    SMOKE._install()
                install.assert_called_once()
                install_command = install.call_args.args[1]
                self.assertEqual(
                    install_command[:3],
                    ["/usr/local/bin/python3", "-B", "-c"],
                )
                install_program = ast.parse(install_command[3])
                commands_assignment = next(
                    node
                    for node in install_program.body
                    if isinstance(node, ast.Assign)
                    and any(
                        isinstance(target, ast.Name) and target.id == "commands"
                        for target in node.targets
                    )
                )
                pip_commands = ast.literal_eval(commands_assignment.value)
                self.assertEqual(
                    [command[0] for command in pip_commands],
                    ["/task/venv/bin/python", "/task/venv/bin/python"],
                )
                self.assertEqual(pip_commands[1][-2:], ["pip", "check"])
                self.assertNotIn("sys.executable", install_command[3])
                self.assertEqual(
                    install.call_args.kwargs["mounts"],
                    [
                        (task_root / "worker", "/input", True),
                        (task_root / "private-caldav-wheels", "/private-wheels", True),
                        (task_root / "venv", "/task/venv", False),
                        (task_root / "workspace", "/task/workspace", False),
                    ],
                )
                self.assertTrue(
                    all(
                        source.is_dir()
                        for source, _target, _readonly in install.call_args.kwargs["mounts"]
                    )
                )
                self.assertTrue(SMOKE._load_summary()["private_dependencies_installed"])

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

    def test_native_marionette_failures_use_fixed_types_and_stages(self) -> None:
        contract = self._load_native_thunderbird_contract()
        self.assertTrue(
            contract.NATIVE_MARIONETTE_FAILURE_STAGES
            <= SMOKE.FIXTURE_FAILURE_STAGES
        )
        exception_classes = {
            "script_timeout",
            "script_error",
            "session_error",
            "other",
        }
        self.assertTrue(
            {
                (stage, error_class)
                for stage in contract.NATIVE_MARIONETTE_FAILURE_STAGES
                for error_class in exception_classes
            }
            <= SMOKE.NATIVE_FAILURE_PAIRS
        )
        cases = (
            (type("ScriptTimeoutException", (Exception,), {}), "script_timeout"),
            (type("TimeoutException", (Exception,), {}), "session_error"),
            (type("JavascriptException", (Exception,), {}), "script_error"),
            (type("InvalidSessionIdException", (Exception,), {}), "session_error"),
            (OSError, "session_error"),
            (type("PrivateExceptionWithSensitiveMessage", (Exception,), {}), "other"),
        )
        for exception_type, expected_class in cases:
            with self.subTest(class_name=exception_type.__name__):
                error = exception_type("private message must not escape")
                observed = contract._marionette_error_class(error)
                self.assertEqual(observed, expected_class)
                self.assertIn(
                    observed,
                    {"script_timeout", "script_error", "session_error", "other"},
                )
                self.assertNotIn(str(error), observed)

        startup_failure = contract._marionette_failure(
            "session_creation",
            type("ScriptTimeoutException", (Exception,), {})("private detail"),
        )
        self.assertEqual(startup_failure.stage, "session_creation")
        self.assertEqual(startup_failure.error_class, "script_timeout")
        unknown_stage = contract._marionette_failure("private_stage", RuntimeError())
        self.assertEqual(unknown_stage.stage, "internal")
        self.assertEqual(unknown_stage.error_class, "unexpected_error")

    def test_each_async_native_operation_preserves_its_fixed_failure_phase(self) -> None:
        contract = self._load_native_thunderbird_contract()
        cases = (
            ("provider_discovery", "ScriptTimeoutException", "script_timeout"),
            ("provider_refresh", "JavascriptException", "script_error"),
            ("provider_edit", "InvalidSessionIdException", "session_error"),
            ("provider_create", "PrivateFailure", "other"),
            ("provider_delete", "ScriptTimeoutException", "script_timeout"),
            (
                "post_revoke_provider_request",
                "JavascriptException",
                "script_error",
            ),
        )
        for stage, class_name, expected_class in cases:
            with self.subTest(stage=stage):
                error = type(class_name, (Exception,), {})("private detail")

                class RaisingMarionette:
                    def execute_async_script(self, _script, script_args):
                        del script_args
                        raise error

                with self.assertRaises(contract.ContractFailure) as raised:
                    contract._async_script(
                        RaisingMarionette(), "private script", [], stage
                    )
                self.assertEqual(raised.exception.stage, stage)
                self.assertEqual(raised.exception.error_class, expected_class)
                self.assertNotIn("private detail", str(raised.exception))

    def test_native_ca_and_calendar_tab_failures_use_fixed_phases(self) -> None:
        contract = self._load_native_thunderbird_contract()
        with patch.object(
            contract.subprocess, "run", return_value=SimpleNamespace(returncode=1)
        ):
            with self.assertRaises(contract.ContractFailure) as ca_failure:
                contract._run_certutil(Path("/tmp/test-only-profile"))
        self.assertEqual(ca_failure.exception.stage, "profile_ca_import")
        self.assertEqual(ca_failure.exception.error_class, "profile_setup_failed")

        class FailingObservation:
            def execute_script(self, _script):
                raise type("JavascriptException", (Exception,), {})("private detail")

        with self.assertRaises(contract.ContractFailure) as tab_failure:
            contract._ensure_calendar_tab(FailingObservation())
        self.assertEqual(tab_failure.exception.stage, "calendar_tab_observation")
        self.assertEqual(tab_failure.exception.error_class, "script_error")
        self.assertNotIn("private detail", str(tab_failure.exception))

        class FailingOpen:
            calls = 0

            def execute_script(self, _script):
                self.calls += 1
                if self.calls == 1:
                    return {
                        "tabmailPresent": True,
                        "calendarModeRegistered": True,
                        "calendarTabOpenBeforeAction": False,
                        "calendarTabOpenAttempted": True,
                        "calendarTabOpenError": False,
                    }
                raise type("ScriptTimeoutException", (Exception,), {})(
                    "private detail"
                )

        with self.assertRaises(contract.ContractFailure) as open_failure:
            contract._ensure_calendar_tab(FailingOpen())
        self.assertEqual(open_failure.exception.stage, "calendar_tab_open")
        self.assertEqual(open_failure.exception.error_class, "script_timeout")

    def test_native_contract_marks_every_closed_marionette_boundary(self) -> None:
        contract = self._load_native_thunderbird_contract()
        tree = ast.parse(NATIVE_THUNDERBIRD_CONTRACT.read_text(encoding="utf-8"))
        observed_stages = set()
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            if (
                node.func.id in {"_marionette_failure", "ContractFailure"}
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
            ):
                observed_stages.add(node.args[0].value)
            if (
                node.func.id == "_async_script"
                and len(node.args) >= 4
                and isinstance(node.args[3], ast.Constant)
                and isinstance(node.args[3].value, str)
            ):
                observed_stages.add(node.args[3].value)
        self.assertEqual(
            observed_stages & contract.NATIVE_MARIONETTE_FAILURE_STAGES,
            contract.NATIVE_MARIONETTE_FAILURE_STAGES,
        )

    def test_jest_report_projects_only_a_known_native_failure_pair(self) -> None:
        self.assertTrue(
            all(
                stage in SMOKE.FIXTURE_FAILURE_STAGES
                and error_class in SMOKE.FIXTURE_FAILURE_CLASSES
                for stage, error_class in SMOKE.NATIVE_FAILURE_PAIRS
            )
        )
        report = {
            "success": False,
            "testResults": [
                {
                    "assertionResults": [
                        {
                            "status": "failed",
                            "failureMessages": [
                                "Error: Native Thunderbird CalDAV contract failed "
                                "(provider_discovery/discovery_cardinality). "
                                "private marker must not escape",
                            ],
                        }
                    ]
                }
            ],
        }
        self.assertEqual(
            SMOKE._classify_jest_report(report),
            ("provider_discovery", "discovery_cardinality"),
        )

        native_failures = (
            ("profile_ca_import", "profile_setup_failed"),
            ("marionette_constructor", "session_error"),
            ("session_creation", "script_timeout"),
            ("calendar_tab_open", "script_error"),
            ("provider_discovery", "script_timeout"),
            ("provider_refresh", "script_error"),
            ("provider_edit", "session_error"),
            ("post_revoke_provider_request", "other"),
        )
        for stage, error_class in native_failures:
            with self.subTest(stage=stage, error_class=error_class):
                report["testResults"][0]["assertionResults"][0][
                    "failureMessages"
                ] = [
                    "Error: Native Thunderbird CalDAV contract failed "
                    f"({stage}/{error_class}). private marker must not escape"
                ]
                self.assertEqual(
                    SMOKE._classify_jest_report(report), (stage, error_class)
                )

        report["testResults"][0]["assertionResults"][0]["failureMessages"] = [
            "Error: Native Thunderbird CalDAV contract failed "
            "(unknown_stage/private marker)."
        ]
        self.assertEqual(
            SMOKE._classify_jest_report(report),
            ("unknown", "unrecognized_native_failure"),
        )

    def test_jest_report_classifies_suite_load_and_fixture_setup_failures(self) -> None:
        self.assertEqual(
            SMOKE._classify_jest_report(
                {
                    "success": False,
                    "testResults": [{"testExecError": {"message": "private data"}}],
                }
            ),
            ("suite_load", "jest_suite_failed"),
        )
        self.assertEqual(
            SMOKE._classify_jest_report(
                {
                    "success": False,
                    "testResults": [
                        {"status": "failed", "assertionResults": []}
                    ],
                }
            ),
            ("suite_load", "jest_suite_failed"),
        )
        self.assertEqual(
            SMOKE._classify_jest_report(
                {
                    "success": False,
                    "testResults": [
                        {
                            "assertionResults": [
                                {
                                    "status": "failed",
                                    "failureMessages": [
                                        "Python CalDAV contract exited 1: private data"
                                    ],
                                }
                            ]
                        }
                    ],
                }
            ),
            ("fixture_setup", "caldav_contract_failed"),
        )

    def test_jest_report_maps_known_runtime_failures_to_closed_classes(self) -> None:
        cases = (
            ("Cannot find module 'private marker'", "module_load_failed"),
            ("ERR_DLOPEN_FAILED", "native_binding_failed"),
            (
                "Jest encountered an unexpected token while loading the test.",
                "typescript_transform_failed",
            ),
            ("Validation Error: invalid Jest config private marker", "invalid_jest_config"),
            ("Exceeded timeout of 120000 ms for a test", "jest_timeout"),
        )
        for message, expected_class in cases:
            with self.subTest(expected_class=expected_class):
                self.assertEqual(
                    SMOKE._classify_jest_report(
                        {
                            "success": False,
                            "testResults": [
                                {
                                    "status": "failed",
                                    "message": message,
                                    "assertionResults": [],
                                }
                            ],
                        }
                    ),
                    ("suite_load", expected_class),
                )

    def test_jest_report_requires_a_bounded_owned_private_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            report = Path(temporary) / "jest-report.json"
            report.write_text('{"success":false,"testResults":[]}', encoding="utf-8")
            report.chmod(0o600)
            self.assertEqual(SMOKE._read_jest_report(report)["success"], False)

            report.write_text("", encoding="utf-8")
            report.chmod(0o600)
            self.assertEqual(
                SMOKE._jest_report_failure_class(report), "jest_report_missing"
            )

            report.write_text("not json", encoding="utf-8")
            report.chmod(0o600)
            self.assertEqual(
                SMOKE._jest_report_failure_class(report), "jest_report_invalid"
            )
            with self.assertRaises(ValueError):
                SMOKE._read_jest_report(report)

            report.write_text(
                '{"success":false,"success":true,"testResults":[]}',
                encoding="utf-8",
            )
            report.chmod(0o600)
            with self.assertRaises(ValueError):
                SMOKE._read_jest_report(report)

            report.write_bytes(b"x" * (SMOKE.MAX_JEST_REPORT_BYTES + 1))
            report.chmod(0o600)
            with self.assertRaises(ValueError):
                SMOKE._read_jest_report(report)

            report.unlink()
            target = Path(temporary) / "target.json"
            target.write_text('{"success":false,"testResults":[]}', encoding="utf-8")
            target.chmod(0o600)
            report.symlink_to(target)
            self.assertEqual(
                SMOKE._jest_report_failure_class(report), "jest_report_invalid"
            )
            with self.assertRaises(ValueError):
                SMOKE._read_jest_report(report)

    def test_worker_diagnostic_is_source_bound_and_rejects_untrusted_fields(self) -> None:
        source_sha = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            diagnostic = Path(temporary) / SMOKE.WORKER_DIAGNOSTIC_FILENAME
            SMOKE._write_worker_diagnostic(
                diagnostic, source_sha, "provider_discovery", "discovery_cardinality"
            )
            self.assertEqual(
                SMOKE._read_worker_diagnostic(diagnostic, source_sha),
                {
                    "fixture_failure_stage": "provider_discovery",
                    "fixture_failure_class": "discovery_cardinality",
                },
            )
            self.assertEqual(diagnostic.stat().st_mode & 0o777, 0o600)

            payload = json.loads(diagnostic.read_text(encoding="utf-8"))
            payload["secret"] = "must-not-be-accepted"
            diagnostic.write_text(json.dumps(payload), encoding="utf-8")
            diagnostic.chmod(0o600)
            self.assertIsNone(SMOKE._read_worker_diagnostic(diagnostic, source_sha))
            self.assertIsNone(SMOKE._read_worker_diagnostic(diagnostic, "b" * 40))

            diagnostic.write_text("{}", encoding="utf-8")
            diagnostic.chmod(0o644)
            self.assertIsNone(SMOKE._read_worker_diagnostic(diagnostic, source_sha))

            diagnostic.chmod(0o600)
            diagnostic.write_text("not json", encoding="utf-8")
            diagnostic.chmod(0o600)
            self.assertIsNone(SMOKE._read_worker_diagnostic(diagnostic, source_sha))

            diagnostic.unlink()
            target = Path(temporary) / "target.json"
            target.write_text("{}", encoding="utf-8")
            target.chmod(0o600)
            diagnostic.symlink_to(target)
            self.assertIsNone(SMOKE._read_worker_diagnostic(diagnostic, source_sha))

            diagnostic.unlink()
            diagnostic.write_bytes(b"x" * 513)
            diagnostic.chmod(0o600)
            self.assertIsNone(SMOKE._read_worker_diagnostic(diagnostic, source_sha))

    def test_summary_validates_and_redacts_fixture_failure_details(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with patch.dict(os.environ, {"RUNNER_TEMP": temporary}):
                summary = SMOKE._initial_summary("a" * 40)
                summary.update(
                    {
                        "status": "failed",
                        "phase": "fixture_run",
                        "failure_class": "jest_failed",
                        "fixture_failure_stage": "provider_discovery",
                        "fixture_failure_class": "discovery_cardinality",
                    }
                )
                SMOKE._write_summary(summary)
                summary_path = Path(temporary) / "thunderbird-private-caldav-summary.json"
                self.assertEqual(
                    json.loads(summary_path.read_text(encoding="utf-8"))["fixture_failure_stage"],
                    "provider_discovery",
                )

                summary["fixture_failure_class"] = "private path or raw failure"
                SMOKE._write_summary(summary)
                observed = json.loads(summary_path.read_text(encoding="utf-8"))
                self.assertEqual(observed["failure_class"], "internal_error")
                self.assertNotIn("private path or raw failure", summary_path.read_text())

    def test_run_fails_closed_while_transferring_worker_diagnostic_to_summary(self) -> None:
        source_sha = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            temporary_path = Path(temporary)
            task_root = temporary_path / "owned-task"
            workspace = task_root / "workspace"
            workspace.mkdir(parents=True)
            summary = SMOKE._initial_summary(source_sha)

            def capture_failure(*_args: object, **kwargs: object) -> str:
                SMOKE._write_worker_diagnostic(
                    task_root / "workspace" / SMOKE.WORKER_DIAGNOSTIC_FILENAME,
                    source_sha,
                    "provider_discovery",
                    "discovery_cardinality",
                )
                raise RuntimeError("raw worker output must not escape")

            with (
                patch.dict(
                    os.environ,
                    {"GITHUB_SHA": source_sha, "RUNNER_TEMP": temporary},
                ),
                patch.object(SMOKE, "_require_prepared", return_value=(task_root, summary)),
                patch.object(SMOKE, "_workspace", return_value=Path(temporary_path / "checkout")),
                patch.object(SMOKE.SMOKE, "_capture_container", side_effect=capture_failure),
            ):
                with self.assertRaises(RuntimeError):
                    SMOKE._run()

            summary_path = temporary_path / "thunderbird-private-caldav-summary.json"
            observed = json.loads(summary_path.read_text(encoding="utf-8"))
            self.assertEqual(observed["status"], "failed")
            self.assertEqual(observed["failure_class"], "jest_failed")
            self.assertEqual(observed["fixture_failure_stage"], "provider_discovery")
            self.assertEqual(
                observed["fixture_failure_class"], "discovery_cardinality"
            )
            self.assertFalse(observed["native_provider_passed"])
            self.assertTrue(all(observed[key] is False for key in SMOKE.RESULT_FIELDS))
            self.assertNotIn("raw worker output", summary_path.read_text())

    def test_public_summary_drops_unrecognized_private_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with patch.dict(os.environ, {"RUNNER_TEMP": temporary}):
                payload = SMOKE._initial_summary("a" * 40)
                payload["personal_secret"] = "must-not-be-written"
                SMOKE._write_summary(payload)
                summary_path = Path(temporary) / "thunderbird-private-caldav-summary.json"
                observed = json.loads(summary_path.read_text(encoding="utf-8"))
                self.assertEqual(set(observed), set(SMOKE._initial_summary("a" * 40)))
                self.assertEqual(observed["schema"], "thunderbird-private-caldav-summary@3")
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

    def test_finalize_preserves_first_fixture_failure_during_cleanup(self) -> None:
        source_sha = "a" * 40
        failed = SMOKE._initial_summary(source_sha)
        failed.update(
            {
                "status": "failed",
                "phase": "fixture_run",
                "failure_class": "jest_failed",
                "fixture_failure_stage": "provider_discovery",
                "fixture_failure_class": "discovery_cardinality",
            }
        )
        with tempfile.TemporaryDirectory() as temporary:
            task_root = Path(temporary) / "owned-task"
            task_root.mkdir()
            environment = {
                "RUNNER_TEMP": temporary,
                "GITHUB_SHA": source_sha,
            }
            with (
                patch.dict(os.environ, environment),
                patch.object(SMOKE, "_task_root", return_value=task_root),
                patch.object(SMOKE.SMOKE, "_cleanup_root", side_effect=RuntimeError),
            ):
                SMOKE._write_summary(failed)
                SMOKE._finalize()
                observed = json.loads(
                    (Path(temporary) / "thunderbird-private-caldav-summary.json").read_text()
                )
                self.assertEqual(observed["failure_class"], "jest_failed")
                self.assertEqual(
                    observed["fixture_failure_stage"], "provider_discovery"
                )
                self.assertEqual(
                    observed["fixture_failure_class"], "discovery_cardinality"
                )


if __name__ == "__main__":
    unittest.main()
