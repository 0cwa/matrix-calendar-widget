# Calendar setup and bot fallback

[Documentation](./README.md) · [Configuration](./configuration.md) · [Project overview](../README.md)

The Matrix Calendar widget is the primary interface. The bot can add a room
calendar and supplies a small fallback for calendar commands. Room access,
event writes, and moderator-driven setup are separate server gates and remain
disabled by default.

**On this page**

- [Setting up a room](#setting-up-a-room)
- [Command reference](#command-reference)
- [Limits and troubleshooting](#limits-and-troubleshooting)
- [Validation scope](#validation-scope)

## Setting up a room

Send the exact, no-argument command `!calendar setup` in the room. Setup is
available only when the server operator enables `ROOM_CALENDAR_SETUP_ENABLED`.
The sender must be a joined room member with calendar-manage permission and be
on an allowed Matrix server. By default, only the server name used by the
normal calendar bot account is allowed; the operator can set
`ROOM_CALENDAR_SETUP_ALLOWED_ACTOR_SERVER_NAMES` to an explicit comma-separated
list. This setup-only list does not change who can read or edit calendars.

Invite the calendar bot before running setup. The bot must be able to send a
room message and write the `im.vector.modular.widgets` state event. Setup also
requires the room to be confirmed unencrypted. Encrypted rooms and rooms whose
encryption state cannot be confirmed are unsupported.

For a statically configured room, setup verifies that exact calendar
collection and adds or reuses its calendar widget. It does not create or rename
that collection. For an unconfigured room, setup reserves a server-generated
calendar ID, creates and verifies a VEVENT collection, then adds the widget.
Dynamic setup requires the separate app-owned binding database configured by
the operator; it never uses the reminder database. A pending result can be
retried with `!calendar setup`; the same reservation is reused. Do not include
a room ID, calendar ID, URL, token, or credential in the command.

For a new widget entry, the operator must configure a safe widget URL with its
`meetings_bot_base_url` and the raw `matrix_room_id=$matrix_room_id` parameter.
A trusted matching widget can be reused without rewriting its URL. If no such
widget exists and the configured URL is not usable, setup stops before
creating a binding or collection. See
[server configuration](configuration.md) and [ADR043](adrs/adr043-moderator-room-calendar-setup.md)
for the settings and full behavior.

Successful setup makes the binding and widget available; it does not enable
room calendar reads, event writes, or reminders. Those retain their separate
server gates and room permission checks. Reminder delivery also has its own
sender membership and power requirements.

| Setup reply                            | What to check                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Setup is disabled or unavailable       | Ask the server operator to check the setup gate, binding store, and widget URL.                         |
| Not authorized                         | Confirm the sender is joined, has calendar-manage permission, and is from an allowed Matrix server.     |
| Bot not ready or widget power required | Invite the bot and grant the room power needed to send messages and write widget state.                 |
| Unsupported room                       | Setup supports only a room confirmed to be unencrypted.                                                 |
| Pending                                | Retry `!calendar setup` later; a pending collection is not available to calendar consumers.             |
| Widget pending                         | The verified calendar remains available under the ordinary access gates; retry setup to add the widget. |
| Conflict or capacity reached           | Ask an administrator to inspect the existing room/widget state or configured binding limit.             |

## Command reference

| Command                                                                         | Behavior                                                                                                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `!calendar help`                                                                | Explain commands and direct users to the widget.                                                               |
| `!calendar setup`                                                               | Set up the room calendar when the server enables moderator-driven setup.                                       |
| `!calendar upcoming [count] [--ids] [--tz IANA]`                                | Show the next 30 days, default five and maximum ten occurrences. `--ids` adds resource IDs for other commands. |
| `!calendar event <resource-id> [--tz IANA]`                                     | Read one resource using its `.ics` ID from `upcoming --ids` or a create reply.                                 |
| `!calendar create <start> <end> "<title>" [--description "<text>"] [--tz IANA]` | Create a single timed event; start and end use `YYYY-MM-DDTHH:mm`.                                             |
| `!calendar delete <resource-id>`                                                | Conditionally delete the whole supported VEVENT series. `cancel` is an alias.                                  |

Send these as ordinary text messages in the room. Start with `!calendar help`
for the command list. Ordinary members can use read commands such as
`!calendar upcoming` and `!calendar event` when room access is enabled and they
pass the room's access checks. `!calendar create` and `!calendar delete`
additionally require event writes and the sender's room permission. When the
operator enables moderator setup, a joined moderator with calendar-manage
permission can run `!calendar setup`; regular members should ask a moderator
or calendar administrator to configure the room. Inviting the bot alone does
not configure a room calendar.

The selected server-side room principal is process-wide: `appservice` is the
default, and deployments may explicitly select `bot-account` (ADR041). This
selects the server identity used for room calendar access; it does not enable
room access or writes. No command accepts a calendar URL, credential, or
principal.

Upcoming event summaries put the title first and show dates and times in the
room's detected language. Timed events include the requested IANA timezone;
all-day events show inclusive date ranges. Resource IDs are hidden by default;
run `!calendar upcoming --ids` to show the `.ics` IDs used by `event` and
`delete`. The explicit `!calendar event <resource-id>` reply includes its ID
after the event details.

Times default to UTC. Creation requires end after start and rejects ambiguous
or nonexistent daylight-saving wall times. Titles are limited to 120 characters,
descriptions to 1,000, and command input to 2,048. Creation does not accept
recurrence, attendees, alarms, or arbitrary resource URLs. The ID is the resource
leaf name, not its VEVENT UID. Imported unsafe IDs are hidden with partial-result
feedback. Recurrence projection diagnostics also produce partial-result feedback.

Every read and write checks current room membership, the action's power-level
policy, and the exact room/calendar binding before requesting the configured
server-side room-calendar principal's OpenID proof: the appservice identity in
`appservice` mode or the dedicated bot account in `bot-account` mode. The Matrix
sender is an actor, never a CalDAV principal. Creates require both the room
access and event-write gates. Deletes read current data and use its ETag; mixed
or otherwise unsafe resources are refused. A conflict requires reloading before
retrying.

## Limits and troubleshooting

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

Calendar replies use `m.text`, empty `m.mentions`, and an optional reply
relation containing only the original event ID. `!calendar help` also includes
a localized `org.matrix.custom.html` formatted body; its ordinary-text body
remains the fallback. Calendar-data replies stay plain text, and no reply
quotes the original command. An encrypted room is served only when encryption
is configured and the SDK confirms encrypted sending. Unknown encryption state
or unavailable encryption prevents command replies and calendar-data access.
Scheduled Matrix reminders are a separate feature and currently support only
unencrypted rooms. Errors use fixed localized messages rather than upstream
exception text.

The process-local command limiter can silently drop commands when its
concurrency or rate limit is full. A missing reply alone does not identify the
cause; check that the bot can safely send in the room and ask an administrator
to verify room setup if calendar data commands do not work.

## Validation scope

Unit tests exercise grammar, bounds, authorization before proof/I/O, replies,
calendar projection, and encryption guards. The hosted room appservice contract
exercises create, upcoming REPORT, event GET, and ETag-protected delete against
isolated Synapse/Radicale, plus a nonmember denial before proof or CalDAV access.
The contract must pass at the candidate's exact revision before merge. It calls
the command service directly; it does not establish actual Element command
entry, encrypted-client interoperability, or production deployment readiness.
