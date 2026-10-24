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

"""Offline checks for the private Thunderbird CalDAV worker scripts."""

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


SCRIPT = Path(__file__).with_name("private_client_thunderbird_contract.py")
SPEC = importlib.util.spec_from_file_location(
    "private_client_thunderbird_worker", SCRIPT
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("private CalDAV worker could not be loaded")

JAVASCRIPT_HARNESS = r"""
const fs = require("node:fs");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const scenario = input.scenario;
const observers = new Set();
const state = { loaded: false, callbackCount: 0, loadedAtEdit: null, modified: false };
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (callback, delay, ...args) => {
  if (scenario === "timeout" && delay === 20_000) {
    queueMicrotask(() => callback(...args));
    return { syntheticTimeout: true };
  }
  return nativeSetTimeout(callback, delay, ...args);
};
globalThis.clearTimeout = handle => {
  if (handle && handle.syntheticTimeout === true) return;
  nativeClearTimeout(handle);
};
const item = {
  isEvent: () => true,
  icalString: "BEGIN:VEVENT\\r\\nX-COMPANY-OPAQUE:keep-this-value\\r\\nEND:VEVENT",
  clone() { return { ...this, title: "synthetic edited title" }; },
};
const calendar = {
  type: "caldav",
  addObserver(observer) { observers.add(observer); },
  removeObserver(observer) { observers.delete(observer); },
  refresh() {
    if (scenario === "provider_error") {
      nativeSetTimeout(() => {
        for (const observer of [...observers]) {
          observer.onError(calendar, 1, "SYNTHETIC_PRIVATE_DETAIL");
        }
      }, 0);
      return;
    }
    if (scenario === "timeout") return;
    nativeSetTimeout(() => { state.callbackCount += 1; }, 0);
    nativeSetTimeout(() => {
      state.loaded = true;
      for (const observer of [...observers]) observer.onLoad(calendar);
    }, 30);
  },
  async getItem() {
    state.loadedAtEdit = state.loaded;
    return state.loaded ? item : null;
  },
  async modifyItem() { state.modified = true; },
};
globalThis.ChromeUtils = {
  generateQI(interfaces) {
    if (JSON.stringify(interfaces) !== JSON.stringify(["calIObserver"])) {
      throw new Error("unexpected observer interface");
    }
    return function QueryInterface() {};
  },
};
globalThis.window = { __mcwPrivateCalDavCalendar: calendar };
const invoke = (script, args) => new Promise((resolve, reject) => {
  try {
    new Function(script).apply(null, [...args, resolve]);
  } catch (_) {
    reject(new Error("script threw"));
  }
});

(async () => {
  const refresh = await invoke(input.refresh, []);
  let callbackAdvanced = state.callbackCount > 0;
  let edit = null;
  if (scenario === "delayed_load") {
    edit = await invoke(input.edit, [
      "private-contract-event",
      "X-COMPANY-OPAQUE",
      "keep-this-value",
      "synthetic edited title",
    ]);
  }
  const output = {
    refreshOk: refresh && refresh.ok === true,
    refreshFailure: refresh && typeof refresh.failure === "string" ? refresh.failure : null,
    callbackAdvanced,
    loadedAtEdit: state.loadedAtEdit,
    editOk: edit && edit.ok === true,
    modified: state.modified,
    observersRemoved: observers.size === 0,
    errorDetailAbsent: !JSON.stringify(refresh).includes("SYNTHETIC_PRIVATE_DETAIL"),
  };
  process.stdout.write(JSON.stringify(output));
})().catch(() => {
  process.stdout.write(JSON.stringify({ harnessFailed: true }));
  process.exitCode = 1;
});
"""


class PrivateClientThunderbirdWorkerTests(unittest.TestCase):
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
            "MCW_PRIVATE_CALDAV_API_ORIGIN": "https://localhost:8443",
            "MCW_PRIVATE_CALDAV_CONTROL_PORT": "12345",
            "MCW_PRIVATE_CALDAV_CONTROL_KEY": "a" * 43,
            "MCW_PRIVATE_CALDAV_PERSONAL_APP_ID": "mcwpc~" + "a" * 48,
            "MCW_PRIVATE_CALDAV_PERSONAL_SECRET": "synthetic-personal-secret",
            "MCW_PRIVATE_CALDAV_CA_FILE": str(ca_file),
            "MCW_PRIVATE_CALDAV_NATIVE_THUNDERBIRD_BIN": str(thunderbird),
            "MCW_PRIVATE_CALDAV_NATIVE_WORKSPACE": "/task/workspace",
        }
        with patch.dict(os.environ, environment):
            cls.worker = importlib.util.module_from_spec(SPEC)
            SPEC.loader.exec_module(cls.worker)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp.cleanup()

    def run_script_scenario(self, scenario: str) -> dict[str, object]:
        node = os.environ.get("MCW_TEST_NODE_BINARY") or shutil.which("node")
        if node is None:
            self.skipTest("Node.js is unavailable")
        completed = subprocess.run(
            [node, "-e", JAVASCRIPT_HARNESS],
            input=json.dumps(
                {
                    "scenario": scenario,
                    "refresh": self.worker.REFRESH_CALENDAR,
                    "edit": self.worker.EDIT_EVENT,
                }
            ),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=5,
        )
        self.assertEqual(completed.returncode, 0)
        value = json.loads(completed.stdout)
        self.assertIsInstance(value, dict)
        return value

    def test_refresh_waits_for_cache_load_before_edit_script_runs(self) -> None:
        value = self.run_script_scenario("delayed_load")

        self.assertEqual(
            value,
            {
                "refreshOk": True,
                "refreshFailure": None,
                "callbackAdvanced": True,
                "loadedAtEdit": True,
                "editOk": True,
                "modified": True,
                "observersRemoved": True,
                "errorDetailAbsent": True,
            },
        )

    def test_refresh_provider_error_fails_closed_without_error_text(self) -> None:
        value = self.run_script_scenario("provider_error")

        self.assertEqual(
            value,
            {
                "refreshOk": False,
                "refreshFailure": "refresh_failed",
                "callbackAdvanced": False,
                "loadedAtEdit": None,
                "editOk": None,
                "modified": False,
                "observersRemoved": True,
                "errorDetailAbsent": True,
            },
        )

    def test_refresh_timeout_fails_closed_and_removes_observer(self) -> None:
        value = self.run_script_scenario("timeout")

        self.assertEqual(
            value,
            {
                "refreshOk": False,
                "refreshFailure": "refresh_failed",
                "callbackAdvanced": False,
                "loadedAtEdit": None,
                "editOk": None,
                "modified": False,
                "observersRemoved": True,
                "errorDetailAbsent": True,
            },
        )


if __name__ == "__main__":
    unittest.main()
