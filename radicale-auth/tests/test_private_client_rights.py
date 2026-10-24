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

from __future__ import annotations

import unittest
from unittest.mock import patch

from radicale.rights.owner_only import Rights as OwnerOnlyRights

from matrix_calendar_radicale_auth.private_client_rights import Rights


APP_ID = "mcwpc~0123456789abcdef0123456789abcdef0123456789abcdef"


class FakeConfiguration:
    def get(self, section: str, key: str) -> object:
        if section == "auth" and key == "type":
            return "matrix_calendar_radicale_auth"
        raise KeyError((section, key))


class FakeCallback:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def rights(self, username: str, path: str) -> str:
        self.calls.append((username, path))
        if username != APP_ID:
            return "rw"
        if path == "/alice/personal/" or path.startswith("/alice/personal/"):
            return "rw"
        return ""


class PrivateClientRightsTests(unittest.TestCase):
    def test_ordinary_matrix_principals_delegate_to_owner_only_unchanged(self) -> None:
        module = __import__(
            "matrix_calendar_radicale_auth.private_client_rights",
            fromlist=["PrivateClientCallbackClient"],
        )
        callback = FakeCallback()
        config = FakeConfiguration()
        with patch.object(
            module.PrivateClientCallbackClient,
            "from_environment",
            return_value=callback,
        ):
            rights = Rights(config)  # type: ignore[arg-type]
        owner_only = OwnerOnlyRights(config)  # type: ignore[arg-type]

        for user, path in (
            ("alice", "/alice/"),
            ("alice", "/alice/personal/"),
            ("alice", "/bob/other/"),
            ("calendarbot", "/calendarbot/room-team/"),
        ):
            with self.subTest(user=user, path=path):
                self.assertEqual(
                    rights.authorization(user, path),
                    owner_only.authorization(user, path),
                )
        self.assertEqual(callback.calls, [])

    def test_reserved_app_ids_use_fresh_callback_and_never_fall_back(self) -> None:
        module = __import__(
            "matrix_calendar_radicale_auth.private_client_rights",
            fromlist=["PrivateClientCallbackClient"],
        )
        callback = FakeCallback()
        with patch.object(
            module.PrivateClientCallbackClient,
            "from_environment",
            return_value=callback,
        ):
            rights = Rights(FakeConfiguration())  # type: ignore[arg-type]

        self.assertEqual(
            rights.authorization(APP_ID, "/alice/personal/event.ics"), "rw"
        )
        self.assertEqual(rights.authorization(APP_ID, "/alice/other/event.ics"), "")
        self.assertEqual(rights.authorization("mcwpc~malformed", "/alice/"), "")
        self.assertEqual(
            callback.calls,
            [
                (APP_ID, "/alice/personal/event.ics"),
                (APP_ID, "/alice/other/event.ics"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
