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


if __name__ == "__main__":
    unittest.main()
