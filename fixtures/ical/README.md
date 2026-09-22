# iCalendar regression fixtures

These fixtures are deliberately small and human-readable. They define interoperability cases that the future CalDAV/iCalendar adapter must preserve.

| Fixture | Purpose |
| --- | --- |
| `simple-timed.ics` | timed VEVENT with named timezone and common fields |
| `all-day.ics` | exclusive all-day DTEND semantics |
| `recurring-weekly.ics` | RRULE plus EXDATE/RDATE |
| `recurrence-override.ics` | RECURRENCE-ID instance override |
| `alarm.ics` | standard VALARM |
| `attendees.ics` | organizer, attendee roles and PARTSTAT |
| `unknown-properties.ics` | unknown/vendor properties that must survive round-trip |
| `mixed-components.ics` | VEVENT with VTODO/VJOURNAL preservation case |

Rules for agents:

1. Minimize real-world bug samples before committing them.
2. Never commit private calendar data.
3. Add a regression fixture for recurrence/timezone/round-trip bugs.
4. Do not “clean up” unknown properties merely because the widget does not render them.
