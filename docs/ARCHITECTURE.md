# Target architecture

## Context

This repository begins as a hard fork of NeoDateFix. NeoDateFix stores meeting metadata in Matrix rooms and creates Matrix meeting rooms. Matrix Calendar Widget keeps the proven widget UI/plumbing but changes the persistence and authorization boundaries.

## Target system

```text
┌────────────────────────────────────────────┐
│ Matrix client (Element first)              │
│                                            │
│  Matrix Calendar Widget                    │
│  React + Matrix Widget Toolkit + MUI       │
│  FullCalendar as a view layer              │
└───────────────────┬────────────────────────┘
                    │ short-lived Matrix OpenID / widget identity
                    │ application API
                    ▼
┌────────────────────────────────────────────┐
│ Calendar gateway + bot                     │
│                                            │
│ • validates widget OpenID identity         │
│ • separates personal and room-owned paths  │
│ • checks room binding, membership, power   │
│ • CalDAV repository                        │
│ • optional app-owned reminder state        │
│ • fallback command handler                 │
└───────────────────┬───────────────┬────────┘
                    │ CalDAV        │ Matrix
                    ▼               ▼
          ┌─────────────────┐   ┌───────────────┐
          │ Radicale        │   │ Homeserver    │
          │ canonical data  │   │ notifications │
          └─────────────────┘   └───────────────┘
```

The gateway and bot are initially one deployable service. Split them only when scaling, isolation, or operational requirements justify another network boundary. PostgreSQL is an optional app-owned store for reminder configuration and claim primitives; it is separate from CalDAV and Synapse. The current store does not enable reminder scheduling or Matrix delivery.

## Principal and authorization boundary

[ADR010](./adrs/adr010-mixed-calendar-principal-model.md) defines two distinct ownership paths:

- **Personal widget calendars** remain associated with the authenticated Matrix user. The gateway validates that user's short-lived OpenID assertion and, once the external plugin work in [#48](https://github.com/0cwa/matrix-calendar-widget/issues/48) and final real-server contract in [#45](https://github.com/0cwa/matrix-calendar-widget/issues/45) are complete, uses only the corresponding user-scoped CalDAV delegation contract.
- **Room-owned bot calendars** belong to the application principal and require an explicit server-side room-to-calendar binding. Room-owned reads and writes remain blocked until the application principal's non-password Radicale authentication path is defined and tested and explicit binding and per-operation authorization checks are implemented. ADR009's user-scoped OpenID delegation does not provide these application-principal credentials.

When the room-owned path is enabled, identity proof and authorization are separate. Widget requests require validated OpenID, current room membership, configured power policy, and a binding for the requested calendar. Bot commands recheck the sender's membership/power and the same explicit binding for each operation. A Matrix sender is authorization and audit context; it does not prove OpenID identity or CalDAV identity. Per-user bot calendars remain deferred.

## Source-of-truth boundaries

| Concern                        | Canonical store                                                     |
| ------------------------------ | ------------------------------------------------------------------- |
| calendar collection            | CalDAV/Radicale                                                     |
| VEVENT fields                  | iCalendar object in Radicale                                        |
| UID, SEQUENCE, recurrence      | iCalendar object                                                    |
| organizer/attendees            | iCalendar object                                                    |
| VALARM                         | iCalendar object                                                    |
| calendar display properties    | CalDAV properties where supported                                   |
| Matrix room ↔ calendar binding | explicit server-side gateway state; M6 work remains open            |
| Matrix reminder recipients     | planned gateway sidecar state, separate from iCalendar              |
| reminder delivery history      | app-owned PostgreSQL store when enabled                             |
| Matrix permissions             | room state plus configured gateway policy for room-owned operations |

## Collection profile

The user-facing term is **Calendar**, not “DAV collection.”

Calendars created by this project use a VEVENT-only supported-component set. Existing collections are interpreted as follows:

- VEVENT only: normal calendar.
- VEVENT + VTODO and/or VJOURNAL: show the VEVENT subset and a non-blocking advanced warning; never delete unsupported objects.
- VTODO only: hidden from the initial calendar UI; candidate for a future task-list surface.
- VJOURNAL only: hidden by default.
- CardDAV/address books: out of scope.

## Domain seams

The application should converge on explicit interfaces instead of allowing upstream NeoDateFix types to become permanent:

```ts
interface CalendarRepository {
  listCalendars(): Promise<Calendar[]>;
  createCalendar(input: CreateCalendarInput): Promise<Calendar>;
  updateCalendar(id: CalendarId, patch: CalendarPatch): Promise<Calendar>;
  deleteCalendar(id: CalendarId): Promise<void>;

  listEvents(
    calendarId: CalendarId,
    range: TimeRange,
  ): Promise<CalendarEvent[]>;
  getEvent(calendarId: CalendarId, id: EventId): Promise<CalendarEvent>;
  createEvent(
    calendarId: CalendarId,
    input: CalendarEventInput,
  ): Promise<CalendarEvent>;
  updateEvent(
    calendarId: CalendarId,
    id: EventId,
    patch: CalendarEventPatch,
  ): Promise<CalendarEvent>;
  deleteEvent(calendarId: CalendarId, id: EventId): Promise<void>;
}
```

The exact TypeScript API is not frozen by this document. The important rule is that UI components do not speak CalDAV directly and server business logic does not depend on FullCalendar models.

## Intended personal widget authentication flow

1. Widget asks the host client for Matrix identity/OpenID credentials.
2. Widget exchanges the short-lived assertion with the calendar gateway.
3. Gateway validates the assertion against the Matrix homeserver.
4. Gateway resolves the asserted Matrix user. Once ADR009-compatible plugin support is available, it performs the user's personal CalDAV operation server-side through user-scoped delegation.
5. For room-scoped operations, the gateway separately checks current room membership, configured power policy, and the explicit room-to-calendar binding. This room-owned path is not enabled until its application-principal authentication prerequisite is complete.
6. Browser never handles the user's Matrix password or long-lived CalDAV credentials.

## Permissions

Personal widget ownership is user-scoped. Room-owned operations require an explicit room-to-calendar binding and current membership plus the configured power-level policy for every operation. The binding and room-owned authorization path remain M6 work; exact policy defaults require implementation validation. The UI is never the authorization boundary.

## Reminder delivery

VALARM expresses _when_ a reminder is due. Matrix recipient targeting is gateway sidecar metadata keyed to a stable event/alarm identity.

Delivery uses Matrix messages with:

- `m.mentions.user_ids` for selected users,
- `m.mentions.room: true` for `@room`, only when the bot/user has permission.

The planned scheduler must be idempotent and keep delivery state across restarts. The persistence primitives are present, but scheduling, recipient configuration, delivery-time authorization, and Matrix sends remain future work.

## MSC4496

MSC4496 is an interoperability design reference. Domain fields should be straightforward to map to its calendar/event/invite/RSVP concepts, but the product must work without homeserver support for the MSC.

## Performance and responsiveness

- Query only the visible calendar range plus a modest prefetch window.
- Do not eagerly expand unbounded recurrence.
- Cache collection metadata and use ETag/sync-token behavior where available.
- Use actual iframe/container size, not device-class assumptions.
- Narrow layouts should prefer agenda/day experiences over unusable mini month grids.

## Transitional upstream code

NeoDateFix meeting-room code remains temporarily because deleting it before a working CalDAV vertical slice would slow development and remove useful tested UI. The migration strategy is strangler-style: introduce repository/domain seams, route existing UI through them, then remove the old Matrix-meeting persistence path.
