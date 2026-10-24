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

import logging
import unittest

from radicale.log import logger

from matrix_calendar_radicale_auth.public_feed_logging import (
    PublicFeedTokenPathFilter,
    install_public_feed_token_path_filter,
)

TOKEN_PATH = "/.token/v1/sentinelPublicFeedToken_0123456789abcdef0123456789abcdef0123/"
PRIVATE_APP_ID = "mcwpc~0123456789abcdef0123456789abcdef0123456789abcdef"


class PublicFeedTokenPathFilterTests(unittest.TestCase):
    def test_redacts_token_paths_at_all_radicale_levels(self) -> None:
        filter_value = PublicFeedTokenPathFilter()

        for level in (
            logging.DEBUG,
            logging.INFO,
            logging.WARNING,
            logging.ERROR,
            logging.CRITICAL,
        ):
            with self.subTest(level=level):
                record = logging.LogRecord(
                    "radicale",
                    level,
                    __file__,
                    1,
                    "request path %r failed: %s",
                    (TOKEN_PATH, TOKEN_PATH),
                    None,
                )

                self.assertTrue(filter_value.filter(record))
                message = record.getMessage()
                self.assertNotIn(TOKEN_PATH, message)
                self.assertNotIn("sentinelPublicFeedToken", message)
                self.assertEqual(message.count("[REDACTED]"), 2)

    def test_redacts_token_paths_from_exception_diagnostics(self) -> None:
        filter_value = PublicFeedTokenPathFilter()
        encoded_token_path = (
            "%2F.token%2Fv1%2F"
            "sentinelPublicFeedToken_0123456789abcdef0123456789abcdef0123"
            "%2F"
        )
        try:
            raise RuntimeError(
                f"native share failed for {TOKEN_PATH} and {encoded_token_path}"
            )
        except RuntimeError:
            import sys

            exception_info = sys.exc_info()

        record = logging.LogRecord(
            "radicale",
            logging.ERROR,
            __file__,
            1,
            "token feed request failed at %s",
            (TOKEN_PATH,),
            exception_info,
        )

        self.assertTrue(filter_value.filter(record))
        self.assertIsNone(record.exc_info)
        self.assertIsNotNone(record.exc_text)
        self.assertNotIn("sentinelPublicFeedToken", record.exc_text or "")
        self.assertIn("[REDACTED]", record.exc_text or "")
        formatted = logging.Formatter("%(levelname)s %(message)s").format(record)
        self.assertNotIn("sentinelPublicFeedToken", formatted)
        self.assertIn("[REDACTED]", formatted)

    def test_redacts_encoded_native_token_storage_filename(self) -> None:
        filter_value = PublicFeedTokenPathFilter()
        encoded_token_path = (
            "%2F.token%2Fv1%2F"
            "sentinelPublicFeedToken_0123456789abcdef0123456789abcdef0123"
            "%2F"
        )
        record = logging.LogRecord(
            "radicale",
            logging.DEBUG,
            __file__,
            1,
            "sharing/token/get: config='/data/collection-db/files/token/%s'",
            (encoded_token_path,),
            None,
        )

        self.assertTrue(filter_value.filter(record))
        message = record.getMessage()
        self.assertNotIn("sentinelPublicFeedToken", message)
        self.assertIn("%2F.token%2Fv1%2F[REDACTED]%2F", message)

    def test_redacts_complete_private_client_alias_paths(self) -> None:
        filter_value = PublicFeedTokenPathFilter()
        paths = (
            f"/{PRIVATE_APP_ID}/calendar/event-private-name.ics",
            f"%2F{PRIVATE_APP_ID}%2Fcalendar%2Fevent-private-name.ics",
        )
        record = logging.LogRecord(
            "radicale",
            logging.INFO,
            __file__,
            1,
            "DAV request %s %s",
            paths,
            None,
        )

        self.assertTrue(filter_value.filter(record))
        message = record.getMessage()
        self.assertNotIn(PRIVATE_APP_ID, message)
        self.assertNotIn("event-private-name", message)
        self.assertEqual(message.count("[PRIVATE-CALDAV-PATH]"), 2)

    def test_unformattable_record_fails_closed(self) -> None:
        filter_value = PublicFeedTokenPathFilter()
        record = logging.LogRecord(
            "radicale", logging.ERROR, __file__, 1, "bad %s %s", (TOKEN_PATH,), None
        )

        self.assertTrue(filter_value.filter(record))
        self.assertNotIn("sentinelPublicFeedToken", record.getMessage())
        self.assertIn("redacted", record.getMessage())

    def test_installation_is_idempotent(self) -> None:
        install_public_feed_token_path_filter()
        install_public_feed_token_path_filter()

        installed = [
            value for value in logger.filters if isinstance(value, PublicFeedTokenPathFilter)
        ]
        self.assertEqual(len(installed), 1)


if __name__ == "__main__":
    unittest.main()
