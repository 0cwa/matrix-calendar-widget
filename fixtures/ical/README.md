# iCalendar regression fixtures

These fixtures are deliberately small and human-readable. They define interoperability cases that the future CalDAV/iCalendar adapter must preserve.

| Fixture                                        | Purpose                                                   |
| ---------------------------------------------- | --------------------------------------------------------- |
| `simple-timed.ics`                             | timed VEVENT with named timezone and common fields        |
| `all-day.ics`                                  | exclusive all-day DTEND semantics                         |
| `recurring-weekly.ics`                         | RRULE plus EXDATE/RDATE                                   |
| `recurrence-override.ics`                      | RRULE/RDATE/EXDATE, alarms, and moved/cancelled instances |
| `recurrence-floating-duration.ics`             | Floating recurrence values and duration units across DST  |
| `recurrence-floating-override.ics`             | Floating RECURRENCE-ID and detached DTSTART duration      |
| `recurrence-utc.ics`                           | UTC RDATE and detached RECURRENCE-ID values               |
| `alarm.ics`                                    | standard VALARM                                           |
| `alarm-uid.ics`                                | stable RFC 9074 VALARM UID preservation                   |
| `attendees.ics`                                | organizer, attendee roles and PARTSTAT                    |
| `interoperable-properties.ics`                 | revision metadata and interoperable properties            |
| `unknown-properties.ics`                       | unknown/vendor properties that must survive round-trip    |
| `mixed-components.ics`                         | VEVENT with VTODO/VJOURNAL preservation case              |
| `vtimezone.ics`                                | embedded VTIMEZONE preservation across DST                |
| `vtimezone-stockholm-bundled-transition.ics`   | bundled IANA rules at the 2026 autumn transition          |
| `vtimezone-stockholm-divergent-transition.ics` | recognized TZID with a conflicting autumn transition      |
| `folded-escaped.ics`                           | escaped text and RFC 5545 content-line folding            |

Rules for agents:

1. Minimize real-world bug samples before committing them.
2. Never commit private calendar data.
3. Add a regression fixture for recurrence/timezone/round-trip bugs.
4. Do not “clean up” unknown properties merely because the widget does not render them.
