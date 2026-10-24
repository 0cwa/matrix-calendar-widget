#!/usr/bin/env python3
"""Check the pinned test-only Python CalDAV dependency closure offline."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


LOCK = Path(__file__).with_name("thunderbird-private-caldav-requirements.txt")
EXPECTED = {
    "caldav",
    "charset-normalizer",
    "click",
    "dnspython",
    "h11",
    "icalendar",
    "icalendar-searcher",
    "jh2",
    "lxml",
    "niquests",
    "python-dateutil",
    "pyyaml",
    "qh3",
    "recurring-ical-events",
    "six",
    "tzdata",
    "urllib3-future",
    "wassima",
    "x-wr-timezone",
}


class PrivateCalDavDependencyLockTests(unittest.TestCase):
    def test_complete_closure_is_exactly_pinned_and_hash_locked(self) -> None:
        entries: dict[str, tuple[str, str]] = {}
        for line in LOCK.read_text(encoding="utf-8").splitlines():
            if not line or line.startswith("#"):
                continue
            match = re.fullmatch(
                r"([A-Za-z0-9_.-]+)==([^ ]+) --hash=sha256:([0-9a-f]{64})",
                line,
            )
            self.assertIsNotNone(match, f"invalid pinned requirement: {line}")
            assert match is not None
            name, version, digest = match.groups()
            normalized = name.lower().replace("_", "-")
            self.assertNotIn(normalized, entries)
            entries[normalized] = (version, digest)

        self.assertEqual(set(entries), EXPECTED)
        self.assertEqual(entries["caldav"][0], "3.5.0")
        self.assertTrue(all(version and digest for version, digest in entries.values()))


if __name__ == "__main__":
    unittest.main()
