# ADR028: Configure room reminders against canonical calendar alarms

- Status: Accepted
- Date: 2026-10-03

## Context

ADR007 defines room-wide Matrix mentions as reminder targets and keeps their
Matrix-specific meaning outside iCalendar. ADR019 supplies a durable
application-owned store keyed by room, bound calendar, event UID, typed
recurrence identity, and stable VALARM UID. The store does not by itself
establish that a configured alarm is currently present, that its trigger can
be evaluated safely, or that a Matrix actor may manage settings for the room.

Projected widget occurrence IDs describe display instances. They are not
canonical VEVENT recurrence identities and cannot safely identify persistent
reminder configuration or delivery records. Recurring alarms also create
multiple firings for one configured master alarm, so configuration identity
and firing identity must remain distinct.

## Decision

### Configuration API

1. Keep reminder settings behind the default-off
   `MATRIX_CALENDAR_REMINDER_CONFIGURATION_ENABLED` gate. The API also requires
   room-calendar access to be enabled and the reminder store to be available.
   Enabling settings permits only manager-authorized configuration and current
   Matrix-state reads; it does not start the scheduler or send reminders.
2. Expose bounded `GET`, `PUT`, and `DELETE` operations for one room's reminder
   configurations. Each request requires the current validated Matrix actor,
   current joined membership, the `io.github.0cwa.matrix-calendar.manage`
   action power, and the exact operator-configured room/calendar binding.
   Resolve those checks before requesting an application-service OpenID proof,
   accessing CalDAV, or touching persistent configuration. A Matrix event
   sender or the actor's user ID is never a CalDAV credential.
   Also require a successful current `m.room.encryption` lookup that confirms
   the room is unencrypted before any reminder store operation or canonical
   source read. Encrypted rooms and missing/invalid encryption state are denied
   with generic errors; the native sender has no supported E2EE path.
3. Accept only a direct calendar resource ID, typed recurrence identity, and
   stable alarm UID when configuring an alarm. Derive the event UID from the
   current resource. Reject unknown request properties and caller-selected
   room, calendar, event UID, recipient, URL, principal, or credential fields.
   Deletion accepts the canonical event UID, typed recurrence identity, and
   alarm UID; it does not fetch CalDAV, so an authorized manager can remove a
   stale configuration after its event has been deleted.
4. Resolve the resource within the exact bound collection and require a unique
   event component and a unique standard DISPLAY `VALARM` selected by its
   stable `UID`. The alarm UID must be unique across all alarms and calendar
   component UIDs in the resource, even when an event UID is already known.
   Validate the single raw VALARM block before saving: duplicate known
   parameters/properties, nested components, and unsupported standard alarm
   properties fail closed; unrecognized `X-` extensions are ignored for
   reminder timing. Verify the trigger against raw source content before
   saving so parser normalization cannot hide duplicate RELATED or VALUE
   parameters.
   Scheduling supports only timezone-resolved UTC or bundled named-TZID
   DATE-TIME anchors and supported relative DISPLAY triggers. DATE and
   floating anchors, absolute triggers, unsupported alarm forms, unknown or
   divergent timezone rules, malformed source values, and ambiguous
   identities fail closed. Imported explicit DATE-TIME wall values follow the
   canonical RFC rule: a DST gap uses the pre-transition offset and an overlap
   uses its first occurrence. RRULE-generated wall times in DST gaps are
   skipped. For initial support, the selected VEVENT must have explicit,
   same-zone DTSTART and DTEND values; DURATION-based event timing is not
   configurable. Never assume that a floating or DATE value means UTC.
5. Initially accept at most 100 repeats and require both the initial and last
   firing to fall within 366 days before or after the selected START/END
   anchor. RELATED=END alarms also require an event duration of at most 366
   days. The canonical scheduler adapter applies this same validator and
   widens recurrence searches by the supported horizon, maximum END-relative
   event duration, and timezone margin.
6. Persist only `(roomId, bound calendarId, eventUid, recurrenceId|null,
alarmUid)`. Return identity tuples only and page them using an exclusive
   bounded keyset cursor; event titles, descriptions, raw iCalendar, ETags,
   DAV URLs, and Matrix credentials are never settings API output or sidecar
   data.

### Firing identity and scheduler bounds

1. A configuration recurrence identity selects one master component or one
   detached override. Each firing uses the typed recurrence identity of the
   actual occurrence, including the typed DTSTART identity for a non-recurring
   event. Keep that firing identity separate from a master/null configuration
   identity and from UI occurrence IDs.
2. Key each firing by
   `(roomId, calendarId, eventUid, occurrenceRecurrenceId, alarmUid,
triggerOrdinal)`. A SHA-256 digest of that identity is the durable delivery
   key and forms the Matrix transaction ID `mcal-reminder-${key}`. Reusing the
   same key makes retries idempotent at the Matrix transaction layer when the
   homeserver honors transaction IDs; it does not claim exactly-once delivery.
3. Bound each scan to 32 room bindings, 100 configuration rows, 100 inspected
   due candidates, and 20 atomic claim attempts, including claims that are
   denied or already complete. Use pages of at most 100 configurations and
   one due candidate per configuration turn so a large due set cannot starve
   other configurations. Use keyset cursors over stable occurrence identity
   and trigger ordinal rather than DTSTART ordering. Keep at most 1,000
   per-configuration cursors in an LRU.
4. Inspect only the interval from 24 hours before scan start through scan
   start. Skipped older candidates do not trigger a catch-up burst. Advance
   the cursor after every claim result, including denied and already-sent
   claims.
5. Claim a firing with a 30-second lease. Bound post-claim work to seven
   seconds and reserve three seconds for lease release. Pass an `AbortSignal`
   to every post-claim adapter operation and require the sender to honor
   cancellation. Before sending, recheck exact configuration existence,
   current room binding and mention permission, and freshly resolve the
   canonical event, occurrence, alarm, trigger, and message content. Release a
   claim when a required recheck fails or the operation is cancelled.
   The Matrix adapter checks current room encryption before it requests
   calendar data and again before sending; encrypted or unknown state fails
   closed.
6. Wire the bounded scheduler and native Matrix adapter behind the separate
   default-false delivery gate. Keep delivery disabled until the combined live
   Matrix/CalDAV and restricted-role PostgreSQL contracts pass and an operator
   supplies valid runtime configuration. The database claim primitive is
   coordination for the default single-replica service, not a general
   multi-replica safety guarantee.
7. Pass cancellation signals through post-claim adapters and bound scheduler
   work to the lease budget. PostgreSQL cancellation is best effort, and the
   external OpenID proof provider may not stop promptly after abort. Stable
   delivery identity, claim fencing, and the lease release reserve remain
   necessary when upstream work completes after its caller's deadline.

## Consequences

- Reminder settings can be enabled independently for authorized managers,
  while scheduling and delivery remain disabled until their separate gates
  pass.
- A selected alarm must have a stable UID and source data the server can
  evaluate without guessing at timezone meaning. Legacy or unsupported alarms
  remain usable by other CalDAV clients but cannot be configured for delivery.
- Sidecar rows remain small and do not duplicate canonical event content.
  Deleting a stale row does not depend on a live CalDAV resource.
- Scan, page, claim, time-window, cancellation, and cursor limits deliberately
  trade immediate catch-up completeness for bounded work and fairness.
- Stable Matrix transaction IDs reduce duplicate sends after retries but do
  not create exactly-once delivery semantics. PostgreSQL claim state and the
  default single-replica deployment remain necessary controls.
