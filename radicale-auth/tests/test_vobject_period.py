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

import datetime
import unittest

import vobject
from radicale import utils


PERIOD_CALENDAR = "\r\n".join(
    [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Matrix Calendar Widget//PERIOD Image Contract//EN",
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Stockholm",
        "BEGIN:DAYLIGHT",
        "TZOFFSETFROM:+0100",
        "TZOFFSETTO:+0200",
        "TZNAME:CEST",
        "DTSTART:19700329T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
        "END:DAYLIGHT",
        "BEGIN:STANDARD",
        "TZOFFSETFROM:+0200",
        "TZOFFSETTO:+0100",
        "TZNAME:CET",
        "DTSTART:19701025T030000",
        "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
        "END:STANDARD",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "UID:tzid-period-image-contract",
        "DTSTAMP:20260922T120000Z",
        "DTSTART;TZID=Europe/Stockholm:20261026T140000",
        "DTEND;TZID=Europe/Stockholm:20261026T150000",
        "RDATE;VALUE=PERIOD;TZID=Europe/Stockholm:20261027T093000/20261027T103000",
        "RDATE;VALUE=PERIOD;TZID=Europe/Stockholm:20261028T093000/PT1H",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ]
)


ORDINARY_RECURRENCE_CALENDAR = "\r\n".join(
    [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Matrix Calendar Widget//Ordinary Recurrence Test//EN",
        "BEGIN:VEVENT",
        "UID:ordinary-rdate-detached-override",
        "DTSTAMP:20260922T120000Z",
        "DTSTART:20261026T093000Z",
        "DTEND:20261026T103000Z",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "RDATE:20261116T093000Z",
        "SUMMARY:synthetic master",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:ordinary-rdate-detached-override",
        "DTSTAMP:20260922T120000Z",
        "RECURRENCE-ID:20261102T093000Z",
        "DTSTART:20261102T110000Z",
        "DTEND:20261102T120000Z",
        "SUMMARY:synthetic override",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ]
)


class VObjectPeriodImageTests(unittest.TestCase):
    def test_ordinary_rdate_and_detached_override_round_trip(self) -> None:
        parsed = vobject.readOne(ORDINARY_RECURRENCE_CALENDAR)
        serialized = parsed.serialize()
        reparsed = vobject.readOne(serialized)

        events = reparsed.contents["vevent"]
        self.assertEqual(len(events), 2)

        master = next(event for event in events if "rrule" in event.contents)
        detached = next(event for event in events if "recurrence-id" in event.contents)
        self.assertEqual(len(master.contents["rdate"]), 1)
        self.assertIsInstance(master.contents["rdate"][0].value[0], datetime.datetime)
        self.assertIn("recurrence-id", detached.contents)

    def test_radicale_reports_period_support(self) -> None:
        self.assertTrue(utils.vobject_supports_period())

    def test_tzid_period_end_and_duration_survive_parse_and_serialize(self) -> None:
        parsed = vobject.readOne(PERIOD_CALENDAR)
        periods = _period_values(parsed)
        serialized = parsed.serialize()

        self.assertIsInstance(periods[0][0], datetime.datetime)
        self.assertIsInstance(periods[0][1], datetime.datetime)
        self.assertIsInstance(periods[1][0], datetime.datetime)
        self.assertIsInstance(periods[1][1], datetime.timedelta)
        self.assertIn("TZID=Europe/Stockholm", serialized)

        reparsed = vobject.readOne(serialized)
        self.assertEqual(_period_values(reparsed), periods)


def _period_values(calendar: vobject.base.Component) -> list[tuple[object, object]]:
    return [
        period
        for line in calendar.vevent.contents["rdate"]
        for period in line.value
    ]
