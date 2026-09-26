# ADR020: Allow explicit DISPLAY alarm creation and removal

- Status: Accepted
- Date: 2026-09-26

## Context

ADR018 limits the widget to editing existing DISPLAY alarm triggers and
descriptions, and keeps event creation alarm-free. M6 reminder sidecars need a
stable identity for an alarm, while users also need an explicit way to add or
remove the standard DISPLAY alarms that should eventually be eligible for
Matrix reminder configuration. Alarm timing remains standard iCalendar data;
Matrix recipients and delivery state remain separate under ADR007 and ADR019.

## Decision

1. Supersede ADR018 only where it prohibits explicit DISPLAY alarm addition or
   removal and explicit alarm creation while creating an event. A new event
   remains alarm-free by default. The user must choose the Add display alarm
   action to create an alarm.
2. Add only `ACTION:DISPLAY` alarms to the master VEVENT. Each new alarm gets
   exactly one unique RFC 9074 `UID` property, generated once when the user
   adds it and preserved with the alarm on subsequent edits. Default the
   relative trigger to 15 minutes before event start and the description to
   the current translated default. The user may edit the supported trigger and
   description fields.
3. Remove only an explicitly selected, supported DISPLAY alarm. Resolve the
   selection against its resource-local alarm index and protect writes with the
   existing conditional CalDAV update. Do not remove or rewrite EMAIL, AUDIO,
   extension, or otherwise unsupported alarm actions.
4. Preserve unknown iCalendar properties, other VALARM components, and legacy
   alarms that have no UID. Do not assign a UID to a legacy alarm unless an
   explicit update supplies one. Preserve all non-targeted source data on
   create, edit, and removal operations.
5. Use the RFC 9074 UID as the future stable alarm identity for ADR007 sidecar
   configuration, in addition to the room, calendar, event UID, and recurrence
   identity. The UID is calendar data, not a Matrix recipient field. This
   decision does not add or change Matrix recipient storage, the authenticated
   reminder configuration API, a scheduler, permission rechecks, or Matrix
   message delivery.
6. Treat alarm UIDs as optional data that external CalDAV clients may remove or
   change. A future configuration API or scheduler must fetch the canonical
   current CalDAV resource, resolve the exact UID, and fail closed when that
   UID is missing, changed, duplicated, or ambiguous. Never fall back to alarm
   order, description, or trigger to guess an identity.
7. Keep ADR018's remaining boundaries: only supported DISPLAY alarms are
   editable; unsupported alarm actions remain inert, and the editor does not
   execute alarms or send notifications.

## Consequences

- Users can deliberately create or remove DISPLAY alarms while new events
  remain alarm-free unless the Add action is used.
- Widget-created alarms have a stable RFC 9074 identity suitable for a future
  sidecar API. Imported UID-less alarms remain interoperable and preserved, but
  cannot be selected by a future sidecar API until an explicit UID is assigned.
- Another CalDAV client can invalidate a configured alarm identity by changing
  or removing its optional UID. Future reminder code must detect that change
  from canonical CalDAV state and stop rather than guessing.
- Matrix-specific reminder configuration, scheduling, delivery-time room
  permission checks, and Matrix sends remain separate implementation work.
