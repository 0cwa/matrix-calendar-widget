# ADR007: Model Matrix reminder targets as sidecar metadata

- Status: Accepted
- Date: 2026-09-22

## Context

iCalendar VALARM expresses alarm timing and behavior but does not naturally model “mention these Matrix users” or “mention @room.” Encoding Matrix authorization and recipient semantics only as custom ICS properties would couple interoperable calendar data to Matrix-specific behavior.

## Decision

Keep standard alarm timing in iCalendar/VALARM.

Store Matrix-specific reminder configuration as gateway sidecar metadata keyed to a stable calendar/event/recurrence/alarm identity.

Use the standard VALARM UID as the alarm identity. Newly created DISPLAY alarms
and explicit edits to legacy alarms without a UID receive a generated UUID.
An ordinary event edit leaves UID-less legacy alarms untouched, and an existing
valid alarm UID survives timing edits. The write API accepts alarm timing and
description, not a caller-selected UID. Malformed, duplicate, or resource-colliding
UIDs make alarm controls unavailable while preserving the imported data.

This stable identity is a prerequisite for Matrix settings; generating an alarm
UID does not register recipients, schedule work, or enable delivery. Canonical
event and recurrence identity rules remain defined in ADR019.

Deliver reminders as normal Matrix messages using standard `m.mentions` fields:

- selected users -> `m.mentions.user_ids`
- room mention -> `m.mentions.room: true`

The gateway must verify recipient visibility and room-mention permission at delivery time. Delivery must be idempotent.

## Consequences

Other CalDAV clients can edit events without needing to understand Matrix metadata. Sidecar lifecycle must follow event deletion, UID/recurrence changes, and calendar deletion carefully.
