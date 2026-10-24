# Copyright 2026 Matrix Calendar Widget contributors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Offline checks for the closed native Thunderbird public-feed worker."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("public_calendar_feed_thunderbird_contract.py")
SPEC = importlib.util.spec_from_file_location(
    "public_calendar_feed_thunderbird_contract", SCRIPT
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("public-feed worker could not be loaded")


class PublicCalendarFeedThunderbirdWorkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        ca_file = root / "synthetic-ca.pem"
        ca_file.write_bytes(b"synthetic certificate placeholder")
        thunderbird = root / "thunderbird"
        thunderbird.write_bytes(b"synthetic binary placeholder")
        os.chmod(thunderbird, 0o700)
        environment = {
            "MCW_PUBLIC_ICS_API_ORIGIN": "https://localhost:8443",
            "MCW_PUBLIC_ICS_URL": "https://localhost:8443/v1/public-calendar-feeds/synthetic.envelope",
            "MCW_PUBLIC_ICS_CONTROL_PORT": "12345",
            "MCW_PUBLIC_ICS_CONTROL_KEY": "a" * 43,
            "MCW_PUBLIC_ICS_CA_FILE": str(ca_file),
            "MCW_PUBLIC_ICS_NATIVE_THUNDERBIRD_BIN": str(thunderbird),
            "MCW_PUBLIC_ICS_NATIVE_WORKSPACE": "/task/workspace",
            "MCW_PUBLIC_ICS_PHASE_FILE": "/task/workspace/public-feed-native-phase.json",
            "MCW_PUBLIC_ICS_SOURCE_SHA": "a" * 40,
        }
        with patch.dict(os.environ, environment):
            cls.worker = importlib.util.module_from_spec(SPEC)
            SPEC.loader.exec_module(cls.worker)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp.cleanup()

    def test_accepts_only_the_local_signed_public_feed_shape(self) -> None:
        self.assertTrue(self.worker._valid_inputs())

        with patch.object(
            self.worker,
            "PUBLIC_URL",
            "https://example.test/v1/public-calendar-feeds/synthetic.envelope",
        ):
            self.assertFalse(self.worker._valid_inputs())
        with patch.object(
            self.worker,
            "PUBLIC_URL",
            "https://localhost:8443/.token/v1/synthetic/",
        ):
            self.assertFalse(self.worker._valid_inputs())
        with patch.object(
            self.worker,
            "PUBLIC_URL",
            "https://localhost:8443/v1/public-calendar-feeds/synthetic.envelope?redirect=1",
        ):
            self.assertFalse(self.worker._valid_inputs())

    def test_requires_exact_anonymous_gateway_observation(self) -> None:
        self.worker._assert_anonymous_exact_route(
            {
                "requestCount": 3,
                "exactRouteCount": 3,
                "authorizationAbsentCount": 3,
                "status200Count": 2,
                "status404Count": 1,
            }
        )
        for state in (
            {
                "requestCount": 3,
                "exactRouteCount": 2,
                "authorizationAbsentCount": 3,
                "status200Count": 2,
                "status404Count": 1,
            },
            {
                "requestCount": 3,
                "exactRouteCount": 3,
                "authorizationAbsentCount": 2,
                "status200Count": 2,
                "status404Count": 1,
            },
        ):
            with self.assertRaises(self.worker.ContractFailure):
                self.worker._assert_anonymous_exact_route(state)

    def test_control_state_rejects_unexpected_fields(self) -> None:
        valid_state = {
            "requestCount": 3,
            "exactRouteCount": 3,
            "authorizationAbsentCount": 3,
            "status200Count": 2,
            "status404Count": 1,
        }
        with patch.object(
            self.worker,
            "_control_request",
            return_value=(200, json.dumps(valid_state).encode()),
        ):
            self.assertEqual(self.worker._state(), valid_state)
        with patch.object(
            self.worker,
            "_control_request",
            return_value=(200, json.dumps({**valid_state, "url": "secret"}).encode()),
        ):
            with self.assertRaises(self.worker.ContractFailure):
                self.worker._state()

    def test_worker_updates_only_the_closed_owned_phase_marker(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            marker = workspace / self.worker.PHASE_FILENAME
            marker.write_text(
                json.dumps(
                    {
                        "schema": self.worker.PHASE_SCHEMA,
                        "profile": "public_ics",
                        "source_sha": "a" * 40,
                        "phase": "jest_start",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            marker.chmod(0o600)
            with (
                patch.object(self.worker, "WORKSPACE", workspace),
                patch.object(self.worker, "PHASE_FILE", marker),
                patch.object(self.worker, "SOURCE_SHA", "a" * 40),
            ):
                self.worker._record_phase("initial_http_start")
                saved = json.loads(marker.read_text(encoding="utf-8"))
                self.assertEqual(
                    saved,
                    {
                        "schema": self.worker.PHASE_SCHEMA,
                        "profile": "public_ics",
                        "source_sha": "a" * 40,
                        "phase": "initial_http_start",
                    },
                )
                self.assertEqual(marker.stat().st_mode & 0o777, 0o600)
                self.assertFalse(
                    (workspace / f"{self.worker.PHASE_FILENAME}.tmp").exists()
                )

                self.worker._record_phase("private event text")
                self.assertEqual(
                    json.loads(marker.read_text(encoding="utf-8"))["phase"],
                    "initial_http_start",
                )

    def test_public_provider_script_uses_marionette_function_arguments(self) -> None:
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node.js is unavailable")

        harness = r"""
const fs = require("node:fs");
const { script } = JSON.parse(fs.readFileSync(0, "utf8"));
const url = "https://localhost:8443/v1/public-calendar-feeds/synthetic.envelope";
const origin = "https://localhost:8443";
const calendar = {
  id: "public-feed-fixture",
  type: "ics",
  readOnly: false,
  name: "",
};
let createdType = null;
let createdUri = null;
let registered = null;
globalThis.cal = {
  manager: {
    createCalendar(type, uri) {
      createdType = type;
      createdUri = uri;
      return calendar;
    },
    registerCalendar(value) {
      registered = value;
    },
    getCalendarById(id) {
      return registered && registered.id === id ? registered : null;
    },
  },
};
globalThis.Services = {
  logins: { getAllLogins: () => [] },
  io: { newURI: value => ({ spec: value }) },
};
globalThis.window = {};

(async () => {
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("callback missing")), 1000);
    const done = value => {
      clearTimeout(timer);
      resolve(value);
    };
    try {
      // Marionette invokes the async script as a function with script args
      // followed by its completion callback; only Thunderbird APIs are mocked.
      new Function(script).call(null, url, origin, done);
    } catch (_error) {
      clearTimeout(timer);
      reject(new Error("provider script threw before completion"));
    }
  });
  const passed = result && result.ok === true &&
    result.providerTypeICS === true &&
    result.readOnlyCalendar === true &&
    result.storedCredentialsAbsent === true &&
    createdType === "ics" && createdUri && createdUri.spec === url &&
    calendar.readOnly === true && registered === calendar &&
    window.__mcwPublicIcsCalendar === calendar;
  process.stdout.write(JSON.stringify({ passed: passed === true }));
  if (passed !== true) process.exitCode = 1;
})().catch(() => {
  process.stdout.write(JSON.stringify({ passed: false }));
  process.exitCode = 1;
});
"""
        completed = subprocess.run(
            [node, "-e", harness],
            input=json.dumps({"script": self.worker.CREATE_PUBLIC_ICS}),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=5,
        )
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(json.loads(completed.stdout), {"passed": True})

    def test_native_timeout_budget_matches_worker_rpc_and_cleanup_bounds(self) -> None:
        self.assertEqual(self.worker.WORKER_PHASE_BUDGET_SECONDS, 615)
        self.assertEqual(self.worker.MARIONETTE_HELLO_TIMEOUT_SECONDS, 60)
        self.assertEqual(self.worker.CALENDAR_TAB_PHASE_BUDGET_SECONDS, 25)
        self.assertEqual(self.worker.EVENT_OBSERVATION_MAX_SECONDS, 6)
        self.assertLessEqual(
            self.worker.EVENT_OBSERVATION_MAX_SECONDS,
            self.worker.MARIONETTE_SCRIPT_TIMEOUT_SECONDS,
        )
        worker_source = (
            Path(__file__)
            .with_name("public_calendar_feed_thunderbird_contract.py")
            .read_text(encoding="utf-8")
        )
        self.assertIn("socket_timeout=MARIONETTE_SOCKET_TIMEOUT_SECONDS", worker_source)
        self.assertIn("+ MARIONETTE_HELLO_TIMEOUT_SECONDS", worker_source)
        self.assertIn("+ CALENDAR_TAB_PHASE_BUDGET_SECONDS", worker_source)
        self.assertIn(
            "marionette.timeout.script = MARIONETTE_SCRIPT_TIMEOUT_SECONDS",
            worker_source,
        )


if __name__ == "__main__":
    unittest.main()
