# Calendar bot fallback

The Matrix Calendar widget is the primary interface. The bot supplies a small
fallback for the exact calendar collection bound to the current room by the
operator. Room access and event writes remain disabled by default.

| Command                                                                         | Behavior                                                                      |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `!calendar help`                                                                | Explain commands and direct users to the widget.                              |
| `!calendar upcoming [count] [--tz IANA]`                                        | Show the next 30 days, default five and maximum ten occurrences.              |
| `!calendar event <resource-id> [--tz IANA]`                                     | Read one resource using its opaque `.ics` ID from upcoming results.           |
| `!calendar create <start> <end> "<title>" [--description "<text>"] [--tz IANA]` | Create a single timed event; start and end use `YYYY-MM-DDTHH:mm`.            |
| `!calendar delete <resource-id>`                                                | Conditionally delete the whole supported VEVENT series. `cancel` is an alias. |

Times default to UTC. Creation requires end after start and rejects ambiguous
or nonexistent daylight-saving wall times. Titles are limited to 120 characters,
descriptions to 1,000, and command input to 2,048. Creation does not accept
recurrence, attendees, alarms, or arbitrary resource URLs. The ID is the resource
leaf name, not its VEVENT UID. Imported unsafe IDs are hidden with partial-result
feedback. Recurrence projection diagnostics also produce partial-result feedback.

Every read and write checks current room membership, the action's power-level
policy, and the exact operator binding before requesting a server appservice
identity proof. The Matrix sender is an actor, never a CalDAV principal. Creates
require both the room access and event-write gates. Deletes read current data
and use its ETag; mixed or otherwise unsafe resources are refused. A conflict
requires reloading before retrying.

The command service applies a process-local bound to `m.text` bodies beginning
with `!calendar`, including help and malformed command prefixes. It admits at
most eight calendar commands at once across the process, two in one room, and
one for a sender in a room. Each canonical room/sender pair may start six
commands in a rolling 60 seconds. The in-memory pair table is capped at 1,000
entries; only inactive entries whose window has expired are evicted. When the
table is full, a new pair is denied. Denied commands are silently dropped
before Matrix state lookups, authorization or proof work, CalDAV access, or
replies, so denials do not create reply traffic. The limiter retains only the
bounded pair, timestamps, and in-flight count in memory, never command text,
and produces no logs or identity-bearing metrics. Legacy `!meeting` commands
do not use this calendar-command limiter.

These limits are local to one server process. They reset on restart and each
replica has an independent quota; they are not a distributed abuse or DDoS
control.

Calendar replies use plain `m.text`, empty `m.mentions`, and an optional reply
relation containing only the original event ID. They do not quote the command
or render event HTML. An encrypted room is served only when encryption is
configured and the SDK confirms encrypted sending. Unknown encryption state or
unavailable encryption prevents calendar access and calendar-data replies.
Errors use fixed localized messages rather than upstream exception text.

Unit tests exercise grammar, bounds, authorization before proof/I/O, replies,
calendar projection, and encryption guards. The hosted room appservice contract
exercises create, upcoming REPORT, event GET, and ETag-protected delete against
isolated Synapse/Radicale, plus a nonmember denial before proof or CalDAV access.
The contract must pass at the candidate's exact revision before merge. It calls
the command service directly; it does not establish actual Element command
entry, encrypted-client interoperability, or production deployment readiness.
