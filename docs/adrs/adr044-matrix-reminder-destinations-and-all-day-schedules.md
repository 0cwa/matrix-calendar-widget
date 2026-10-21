# ADR-044: Matrix reminder destinations and all-day schedules

- Status: Accepted
- Date: 2026-10-21
- Scope: Matrix reminders configured beside canonical CalDAV alarms
- Preserves: ADR005, ADR006, ADR010, ADR014, ADR019, ADR028, ADR033,
  ADR039, ADR041, and ADR043

## Context

The widget can store a room reminder for a supported relative CalDAV alarm,
but reminder configuration rejects all-day `DATE` events and the editor does
not let a manager select individual Matrix recipients. Calendar alarm timing
and Matrix notification routing are separate choices: CalDAV remains the
canonical event store and its alarms must continue to round-trip unchanged.

The initial M6 scope accepted room-wide Matrix reminders and deferred selected
Matrix recipients. A follow-up request requires both room-wide and selected
people, and requires Matrix reminders to be configurable alongside CalDAV
alarms for timed and all-day events. Email attendee delivery remains outside
this decision.

## Decision

1. Keep the CalDAV `VEVENT` and its `VALARM` as the canonical alarm. Store
   Matrix destination and any all-day schedule in the application-owned
   reminder sidecar, keyed by the existing room, calendar, event UID,
   recurrence ID, and stable alarm UID. Never rewrite a `DATE` event as a
   timed event or encode Matrix recipients/schedules in iCalendar properties.
2. A manager may configure either the whole room or up to 50 unique Matrix
   user IDs. The selected-user list must contain current joined members at
   configuration time. Do not infer recipients from attendee addresses,
   event ownership, or other event properties. The configured Matrix room
   remains visible to its members; user targeting controls notification
   mentions, not room access.
3. At delivery, revalidate the current room/calendar binding, encryption
   state, bot membership, message power, and target-specific power. Whole-room
   reminders require permission to use `m.mentions.room`. Selected-user
   reminders use standard `m.mentions.user_ids` and require permission to
   send `m.room.message`. Intersect selected IDs with current joined members
   immediately before sending. If none remain, do not send or fall back to a
   room mention; record a terminal `no-current-recipients` skip.
4. Preserve one stable delivery identity per alarm firing, independent of
   destination, schedule, or configuration revision. Configuration revisions
   invalidate stale in-flight candidate work. An edit after a firing has
   already been sent cannot create a second delivery for that occurrence.
5. Keep timed alarms anchored to the canonical event instant and their
   supported relative trigger. For all-day `DATE` events, require an explicit
   sidecar schedule with `daysBefore`, a local `HH:mm`, and an IANA time-zone
   identifier. A visible 09:00 value may be offered as an unsaved draft; it is
   stored only after the manager saves it. Resolve the selected local time
   using the shared calendar time-zone utility. Do not assume UTC or the
   browser's time zone.
6. Do not send past reminders retroactively. For a one-time all-day event,
   require a future local reminder instant before saving. For a recurring
   series with a past current occurrence, explain that it will not be sent and
   that future occurrences use the saved schedule. Bound the scheduler's
   canonical-source lookahead by the configured day offset and time-zone
   margin, independently of the CalDAV alarm's relative trigger.
7. Show supported and unsupported CalDAV alarms in one reminder surface for
   timed and all-day events. Keep CalDAV alarm timing visible beside the
   Matrix destination. Give unsupported alarms a specific reason and a direct
   path to edit the CalDAV alarm; never hide or silently drop its properties.
   Save the canonical CalDAV alarm before Matrix sidecar settings and report a
   sidecar failure while keeping the editor open and the calendar alarm
   intact.
8. Migrate the reminder store forward only. Migration 2 adds target JSON,
   nullable all-day schedule JSON, and configuration revision; old rows
   receive whole-room, no all-day schedule, and revision 1 defaults. Migration
   3 adds a constrained skipped-delivery reason. Neither migration deletes
   configurations, delivery rows, or stable firing identities. Unknown
   persisted metadata fails closed.

## Consequences

Managers can keep a calendar-app alarm and choose whether the Matrix bot pings
the whole room or selected current members. All-day reminders need an explicit
local schedule, while the original CalDAV event remains all-day. A schedule
whose delivery time has passed will not create an immediate notification.

The migration is additive and preserves legacy room-wide settings. Rolling
back to a binary that predates selected recipients is unsafe while the
scheduler is active: it cannot understand a selected-user destination and
could interpret the row as a whole-room mention. Never run pre-ADR044 server
code with reminder delivery enabled while selected-user rows exist. A rollback
must disable and quiesce reminder delivery before starting older code, retain
the forward-migrated database and all rows, and keep delivery disabled until a
compatible server is restored. Prefer a compatible forward fix when the
selected-user rows must remain active. No downgrade migration is provided.
