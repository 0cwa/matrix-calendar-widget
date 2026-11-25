#!/usr/bin/env python3
"""Check the pinned test-only Python CalDAV and Radicale closures offline."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


LOCK = Path(__file__).with_name("thunderbird-private-caldav-requirements.txt")
RADICALE_LOCK = (
    Path(__file__).parents[1]
    / "radicale-auth"
    / "thunderbird-private-caldav-runtime-requirements.txt"
)
DOCKERFILE = Path(__file__).with_name("thunderbird-private-caldav.Dockerfile")
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
EXPECTED_RADICALE = {
    "certifi": (
        "2025.1.31",
        "ca78db4565a652026a4db2bcdf68f2fb589ea80d0be70e03929ed730746b84fe",
    ),
    "charset-normalizer": (
        "3.5.2",
        "7218e8f32b0956cfcd048fd42d9d5779809745ca1d86113ca56f66e7ae1549c4",
    ),
    "defusedxml": (
        "0.7.1",
        "a352e7e428770286cc899e2542b6cdaedb2b4953ff269a210103ec58f6198a61",
    ),
    "idna": (
        "3.10",
        "946d195a0d259cbba61165e88e65941f16e9b36ea6ddb97f00452bae8b1287d3",
    ),
    "libpass": (
        "1.9.3",
        "3cbeb14d22086660e92c30d787ea981973d67394e81c8c870e1a83cfe1c84353",
    ),
    "pika": (
        "1.3.2",
        "0779a7c1fafd805672796085560d290213a465e4f6f76a6fb19e378d8041a14f",
    ),
    "python-dateutil": (
        "2.9.0.post0",
        "a8b2bc7bffae282281c8140a97d3aa9c14da0b136dfe83f850eea9a5f7470427",
    ),
    "pytz": (
        "2025.2",
        "5ddf76296dd8c44c26eb8f4b6f35488f3ccbf6fbbd7adee0b7262d43f0ec2f00",
    ),
    "radicale": (
        "3.8.0",
        "28f579ef86870f6758d06b91b87e8681145a129453809b088e68784ee849e56b",
    ),
    "requests": (
        "2.32.5",
        "2462f94637a34fd532264295e186976db0f5d453d1cdd31473c85a6a161affb6",
    ),
    "six": (
        "1.17.0",
        "4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274",
    ),
    "urllib3": (
        "2.5.0",
        "e6b01673c0fa6a13e374b50871808eb3bf7046c4b125b216f6bf1cc604cff0dc",
    ),
    "vobject": (
        "0.9.9",
        "0fbdb982065cf4d1843a5d5950c88510041c6de026bda49c3502721de1c6ac3d",
    ),
}


def parse_lock(path: Path) -> dict[str, tuple[str, str]]:
    entries: dict[str, tuple[str, str]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(
            r"([A-Za-z0-9_.-]+)==([^ ]+) --hash=sha256:([0-9a-f]{64})",
            line,
        )
        if match is None:
            raise AssertionError(f"invalid pinned requirement in {path.name}")
        name, version, digest = match.groups()
        normalized = name.lower().replace("_", "-")
        if normalized in entries:
            raise AssertionError(f"duplicate package in {path.name}")
        entries[normalized] = (version, digest)
    return entries


class PrivateCalDavDependencyLockTests(unittest.TestCase):
    def test_complete_closure_is_exactly_pinned_and_hash_locked(self) -> None:
        entries = parse_lock(LOCK)
        self.assertEqual(set(entries), EXPECTED)
        self.assertEqual(entries["caldav"][0], "3.5.0")
        self.assertTrue(all(version and digest for version, digest in entries.values()))

    def test_radicale_runtime_closure_is_exactly_pinned_and_hash_locked(self) -> None:
        entries = parse_lock(RADICALE_LOCK)
        self.assertEqual(entries, EXPECTED_RADICALE)

    def test_overlapping_wheels_reuse_the_reviewed_private_lock_hashes(self) -> None:
        private_entries = parse_lock(LOCK)
        radicale_entries = parse_lock(RADICALE_LOCK)
        for name in ("charset-normalizer", "python-dateutil", "six"):
            with self.subTest(package=name):
                self.assertEqual(radicale_entries[name], private_entries[name])

    def test_radicale_image_builds_its_venv_from_the_pinned_target_python(self) -> None:
        source = DOCKERFILE.read_text(encoding="utf-8")
        self.assertIn(
            "FROM docker.io/library/python:3.13.17-slim-bookworm@sha256:"
            "4cea12ab7d78a3312c85f8cab19b6971d4fe9704da25443986c0bc20a6678850",
            source,
        )
        self.assertIn("/usr/local/bin/python3 -m venv /app", source)
        self.assertIn("/app/bin/python -B -m pip install", source)
        self.assertIn("--isolated --no-cache-dir --no-deps", source)
        self.assertIn("--require-hashes --only-binary=:all:", source)
        self.assertIn("/app/bin/python -B -m pip check", source)
        self.assertIn("/app/bin/python -B /tmp/apply_vobject_period_patch.py", source)
        self.assertIn("import radicale, vobject.icalendar", source)
        self.assertIn("/thunderbird-private-caldav-runtime-requirements.txt", source)
        self.assertNotIn("FROM ghcr.io/kozea/radicale:", source)
        self.assertNotIn("COPY --from=radicale-runtime /app /app", source)


if __name__ == "__main__":
    unittest.main()
