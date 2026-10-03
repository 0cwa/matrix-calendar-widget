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

The gateway and bot are initially one deployable service. Split them only when scaling, isolation, or operational requirements justify another network boundary. PostgreSQL is an optional app-owned store for reminder configuration and claim primitives; it is separate from CalDAV and Synapse. The reminder configuration API and scheduler runtime are wired behind separate default-off gates; a database store by itself does not enable Matrix delivery.

## Principal and authorization boundary

[ADR014](./adrs/adr014-split-widget-and-bot-calendar-principals.md) and
[ADR015](./adrs/adr015-server-managed-room-calendar-bindings.md) define two
distinct ownership paths and the initial room-target contract:

- **Personal widget calendars** remain associated with the authenticated Matrix
  user. The gateway validates that user's short-lived OpenID assertion and
  delegates the same actor proof to the project-owned Radicale Auth module
  selected by ADR024. PR #146 completed the OpenID-only backend and image for
  [#48](https://github.com/0cwa/matrix-calendar-widget/issues/48); PR #147
  completed the real-container gateway contract for
  [#45](https://github.com/0cwa/matrix-calendar-widget/issues/45): same-user
  enumeration, invalid-identity rejection, and nonmember denial before CalDAV
  I/O. A focused mocked `CalendarGatewayMembershipGuard` test directly covers
  a thrown membership lookup and an `isAllowed=false` denial before
  provider/CalDAV I/O. This validates the pinned development stack only; the
  etke image override and `/data` host rehearsal remain unverified deployment
  gates.
- **Room-owned calendars** are planned to belong to the application principal.
  Their path will resolve a canonical Matrix room ID through an
  operator-managed static binding. The binding resolver and application-
  principal room path are foundations only; that static-binding path is not
  wired to CalDAV until M6 issue #7 implements and validates ADR024's
  appservice OpenID mode, authorization-before-mint ordering, and cross-room
  isolation against real Radicale. The user's proof authenticates the widget
  actor; the separate appservice proof identifies the room calendar's CalDAV
  principal.

Existing room-context gateway routes remain active and make CalDAV requests
under the authenticated requesting user's principal. They enforce current
joined-room membership and action-specific power through
`MatrixCalendarAuthorizationFactory`; authorization lookup failures deny the
request. The policy foundation in this slice makes those checks fail closed.

Identity proof and authorization are separate. Existing widget room-context
requests validate the requesting user's identity and separately check current
room membership and action-specific power. Future application-principal widget
requests must also check the static binding for the requested calendar. Bot
commands must recheck sender membership/power and that binding for each
operation. A Matrix sender is authorization and audit context; it does not
prove OpenID identity or CalDAV identity. Per-user bot calendars remain
deferred.

## Source-of-truth boundaries

| Concern                        | Canonical store                                                     |
| ------------------------------ | ------------------------------------------------------------------- |
| calendar collection            | CalDAV/Radicale                                                     |
| VEVENT fields                  | iCalendar object in Radicale                                        |
| UID, SEQUENCE, recurrence      | iCalendar object                                                    |
| organizer/attendees            | iCalendar object                                                    |
| VALARM                         | iCalendar object                                                    |
| calendar display properties    | CalDAV properties where supported                                   |
| Matrix room ↔ calendar binding | operator-managed server configuration (ADR015)                      |
| Matrix reminder configuration  | gateway sidecar state, separate from iCalendar                      |
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

## Authentication and room-target authorization

1. Widget asks the host client for Matrix identity/OpenID credentials.
2. Widget exchanges the short-lived assertion with the calendar gateway.
3. Gateway validates the assertion against the Matrix homeserver.
4. Personal operations use the validated actor's request-scoped proof under
   ADR009 and the clean-room adapter selected by ADR024.
5. A room-target operation separately checks actor identity, current
   membership, action-specific power, and the configured room-to-calendar
   binding before asking the homeserver for an appservice OpenID proof or
   making any CalDAV request.
6. The browser never handles Matrix passwords, bot credentials, or long-lived
   CalDAV credentials.

## Permissions

Personal widget ownership is user-scoped. Room policy requires current joined
membership for all actions. Joined members may list/read; event create/update/
delete requires the dedicated calendar event-write power, then `events_default`,
then Matrix's default of 0. Calendar-management actions require the dedicated
calendar-manage power, then `state_default`, then Matrix's default of 50.
Only a genuine missing power-level event (`M_NOT_FOUND`) uses Matrix defaults;
permission, network, server, or other lookup failures deny the action. The
membership/power policy is used by existing user-principal room-context routes;
the static-binding/application-principal route is not wired to CalDAV. The UI
is never the authorization boundary.

## Room/calendar binding

The initial binding source is the server-only `ROOM_CALENDAR_BINDINGS` JSON
array. Each entry maps one canonical Matrix room ID to one app-owned calendar
identifier, and each calendar identifier can map to only one room. The server
validates the entire array before resolution so duplicate entries cannot be
silently overwritten. Missing, malformed, duplicate, ambiguous, or
request-mismatched bindings fail with opaque errors. A browser-supplied href or
URL cannot select or create a binding. Room members cannot change bindings;
collection create/delete/rename and room rebinding remain operator-managed.

The resolver is a pure in-memory function and performs no network or CalDAV
I/O. Application-principal room-owned access remains blocked on M6 issue #7
and deployment isolation: Radicale `owner_only` grants the application
principal access to its whole home, so that home must stay within one trusted
organizational boundary or use equivalent per-room isolation. M2 #48/#45 are
complete for personal actor authentication and same-user enumeration; they do
not accept appservice proof or prove room isolation. The actual etke-host
custom-image override and preservation of its `/data` store remain unverified
deployment gates. Existing user-principal room-context routes are separate and
remain active.

## Reminder delivery

VALARM expresses _when_ a reminder is due. Matrix recipient targeting is gateway sidecar metadata keyed to a stable event/alarm identity.

The initial delivery target is a Matrix room-wide mention using
`m.mentions.room: true`, only when the current room state grants the bot
permission. Individual Matrix recipients remain out of scope.

The bounded scheduler uses persistent claim state and stable Matrix transaction IDs across retries. Configuration and delivery each require an operator gate; delivery also rechecks current room binding, encryption state, and mention permission before resolving the canonical alarm and sending. The feature remains disabled by default, and production database/host validation remains open.

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
