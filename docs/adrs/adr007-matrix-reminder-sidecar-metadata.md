# ADR007: Model Matrix reminder targets as sidecar metadata

[Decision index](./README.md) · [Documentation](../README.md)

- Status: Accepted
- Date: 2026-09-22

> **Later implementation (2026-10-21):** Merged reminder delivery supports
> whole-room mentions under [ADR028](./adr028-room-reminder-configuration-and-delivery.md)
> and [ADR033](./adr033-room-reminder-alarm-options.md). Selected-user and all-day
> delivery are proposed in open [PR #384](https://github.com/0cwa/matrix-calendar-widget/pull/384),
> not implemented on the current main branch. The idempotency requirement below
> does not promise exactly-once Matrix delivery; see the claim and retry limits
> in [ADR019](./adr019-postgresql-reminder-sidecar-store.md) and ADR028.

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
