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
                    │ Matrix OpenID / widget identity
                    │ application API
                    ▼
┌────────────────────────────────────────────┐
│ Calendar gateway + bot                     │
│                                            │
│ • validates Matrix identity                │
│ • checks room membership / calendar policy │
│ • CalDAV repository                        │
│ • reminder scheduler                       │
│ • Matrix-specific sidecar metadata         │
│ • fallback command handler                 │
└───────────────────┬───────────────┬────────┘
                    │ CalDAV        │ Matrix
                    ▼               ▼
          ┌─────────────────┐   ┌───────────────┐
          │ Radicale        │   │ Homeserver    │
          │ canonical data  │   │ notifications │
          └─────────────────┘   └───────────────┘
```

The gateway and bot are initially one deployable service. Split them only when scaling, isolation, or operational requirements justify another network boundary.

## Source-of-truth boundaries

| Concern                        | Canonical store                       |
| ------------------------------ | ------------------------------------- |
| calendar collection            | CalDAV/Radicale                       |
| VEVENT fields                  | iCalendar object in Radicale          |
| UID, SEQUENCE, recurrence      | iCalendar object                      |
| organizer/attendees            | iCalendar object                      |
| VALARM                         | iCalendar object                      |
| calendar display properties    | CalDAV properties where supported     |
| Matrix room ↔ calendar binding | Server-managed configuration (ADR015) |
| Matrix reminder recipients     | gateway sidecar store                 |
| reminder delivery history      | gateway store                         |
| Matrix permissions             | Matrix room state + configured policy |

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

## Authentication flow

1. Widget asks the host client for Matrix identity/OpenID credentials.
2. Widget exchanges the short-lived assertion with the calendar gateway.
3. Gateway validates the assertion against the Matrix homeserver.
4. Gateway resolves Matrix user, room, membership, and calendar policy.
5. Gateway performs permitted CalDAV operations server-side.
6. Browser never handles the user's Matrix password or long-lived CalDAV credentials.

## Permissions

Start with Matrix room membership plus a small configurable policy mapped to power levels. Example policy:

- room member: view calendar,
- configured minimum PL: create events,
- event creator or configured minimum PL: edit/delete,
- configured minimum PL: manage calendars,
- configured minimum PL and Matrix room permission: schedule `@room` mentions.

Exact defaults require implementation validation and may become a dedicated ADR.

## Room/calendar binding

The initial room-to-calendar source of truth is a server-managed configuration
map keyed by canonical Matrix room IDs (ADR015). Each configured room resolves
to exactly one app-owned calendar identifier; a collection identifier can be
assigned to only one room. A missing, malformed, duplicate, ambiguous, or
cross-room binding fails closed before CalDAV discovery or access.

The server resolves configured identifiers under the configured Radicale
service and the ADR014 room principal. A browser-supplied href or URL is never
the binding authority, and the gateway does not enumerate the service
principal's whole home to select a room target. Only an operator-managed server
configuration change may change a binding; the widget and room members cannot
write or override it. Dynamic database, room-state, or widget-managed binding
requires a separate ADR. Under this initial contract, the widget can read and
manage events in the bound collection; collection creation, deletion, and
rename remain operator/configuration-managed so collection lifecycle cannot
leave a dangling or unbound target.

For a room-bound widget or bot request, the gateway validates the request actor,
current membership, action-specific power, and the configured binding before
CalDAV access. The room principal's credentials stay server-side. Personal
widget targets continue to use the validated user's principal. The current
`owner_only` Radicale policy still grants the room principal whole-home access,
so the deployment must keep that home within one trusted organizational
boundary or establish equivalent per-room isolation. Actual room-target CalDAV
access remains gated on the OpenID plugin and real-Radicale contract (#48/#45).

## Reminder delivery

VALARM expresses _when_ a reminder is due. Matrix recipient targeting is gateway sidecar metadata keyed to a stable event/alarm identity.

Delivery uses Matrix messages with:

- `m.mentions.user_ids` for selected users,
- `m.mentions.room: true` for `@room`, only when the bot/user has permission.

The scheduler must be idempotent and keep delivery state so restarts do not duplicate reminders.

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
