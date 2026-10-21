# Calendar data model

[Documentation](./README.md) · [Architecture](./ARCHITECTURE.md) · [Calendar package](../packages/calendar/README.md)

Radicale stores canonical calendar collections and iCalendar resources. The shared TypeScript model gives the widget and gateway a bounded view of those resources without making Matrix room events or a rendering library the storage format.

The implementation is authoritative: start with [`model/calendar.ts`](../packages/calendar/src/model/calendar.ts), [`repository/calendarRepository.ts`](../packages/calendar/src/repository/calendarRepository.ts), and the server's [`ICalendarEventCodec`](../matrix-calendar-server/src/caldav/ICalendarEventCodec.ts). The inherited meeting-room schema is preserved separately in the [NeoDateFix archive](./archive/neodate-data-model.md).

## Identity and ownership

| Value               | Meaning                                                              | Handling rule                                                                                              |
| ------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Calendar.id`       | Opaque collection identifier resolved by the repository              | Do not interpret a browser-supplied value as permission or an arbitrary backend URL                        |
| `CalendarEvent.id`  | Opaque event-resource identifier within a calendar                   | Use with its calendar ID when reading or editing the canonical resource                                    |
| `CalendarEvent.uid` | Stable iCalendar `UID`                                               | Preserve on edits; it is not a Matrix event ID                                                             |
| Occurrence identity | A typed original recurrence value identifying a member of a series   | Preserve its date/floating/zoned kind; keep projected view identity separate from source-resource identity |
| ETag                | CalDAV resource revision used for conditional writes                 | Keep transport bookkeeping separate from the domain; report stale writes as conflicts                      |
| Room ID and binding | Server-managed mapping from a Matrix room to one room-owned calendar | Resolve and authorize on the server before using the room principal                                        |

Personal calendars use the authenticated actor's CalDAV principal. Room calendars use the configured application-service or normal-bot principal after actor and binding checks. Changing that principal changes the Radicale home; it does not migrate existing data.

## Calendars

`Calendar` contains an ID, name, optional description/color/timezone, and capability metadata such as `readOnly`, `operatorManaged`, and `supportedComponents`.

New collections are created with a VEVENT-only component set. Existing mixed collections remain intact: the calendar UI can expose their events, but must preserve other components and refuse unsafe collection deletion. VTODO-only and VJOURNAL-only collections remain outside the main calendar list. A reported timezone is metadata; collection-timezone editing is still deferred.

The repository uses explicit operations for create, rename, description, color, and deletion. Avoid a generic metadata patch that silently implies support for unimplemented properties. An operator-managed room calendar is provisioned and bound outside ordinary personal-calendar management.

## Event timing

Timed and all-day values are different types:

| Form                    | Stored domain value                       | Meaning                                                                     |
| ----------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| Zoned timed endpoint    | `{ type: 'zoned', local, timezone }`      | Local wall time plus a named zone; daylight-saving rules affect its instant |
| Floating timed endpoint | `{ type: 'floating', local }`             | Local wall time with no assigned zone; preserve that absence                |
| All-day event           | `{ type: 'all-day', startDate, endDate }` | Calendar dates with an **exclusive** end date                               |
| Query window            | `{ start, end }`                          | Inclusive start instant and exclusive end instant                           |

A one-day all-day event on 21 October has `startDate: '2026-10-21'` and `endDate: '2026-10-22'`. It is not a midnight UTC event. Likewise, a floating value must not acquire the editor's current zone during a round trip. Timed start and end retain their own value kind.

The [timezone package](../packages/ical-timezones/README.md) provides pinned VTIMEZONE data. Unknown or conflicting timezone definitions can produce a diagnostic or prevent safe projection. Never infer that the absence of a warning proves every resource was displayed.

## Event fields and edits

The shared event model includes title, description, location, URL, status, transparency, categories, priority, timing, and supported recurrence/alarm fields. Read-only projection metadata includes revision information, safe external links, and unsupported-form markers.

`CalendarEventInput` describes creation. `CalendarEventPatch` describes supported changes without allowing the caller to change resource identity, calendar ownership, or stable UID. Some mutations use explicit operation types for removal, attachment changes, recurrence changes, or occurrence edits. Omitting a field and explicitly removing a property are different operations.

The server codec reads the original iCalendar source and patches supported fields while retaining unknown content. It owns revision metadata updates. ETag checks protect against concurrent changes between read and write. The editor must surface an unsupported operation or conflict rather than normalizing away data it does not understand.

Safe URI links are displayed explicitly without fetching previews. Supported authoring is bounded: one safe conference link, one URI attachment operation per save, and supported DISPLAY alarm metadata. Binary uploads, attendee/email authoring, and arbitrary recurrence edits remain outside that editor contract. The relevant [ADRs](./adrs/README.md) define exact accepted shapes.

## Recurrence and projection

One canonical resource can contain the master event and detached overrides. The domain retains typed RRULE/RDATE/EXDATE and recurrence identities; the projector materializes only supported occurrences within bounded work and the requested range.

The widget distinguishes the selected occurrence's display identity and timing from the resource that must be read or patched. A recurring event's projected instance must never be saved as an unrelated new source event just because it has a different display ID.

Supported changes include the documented simple rules, selected-occurrence timing/text changes, skip/restore, and a bounded timing-only following operation. General rule splitting and arbitrary per-occurrence edits are not implied. [ADR034](./adrs/adr034-bounded-following-timing-edits.md) defines the finite-series following limit; [ADR040](./adrs/adr040-selected-occurrence-text-fields.md) defines the selected text fields.

Projection diagnostics are count-based and do not expose source-event details. Some unsupported recurrence or timezone forms may be omitted from the visible projection while the original resource remains in CalDAV. Consequently, a widget event list is not a full-fidelity export. Public subscriptions use the canonical Radicale response instead.

## Application metadata outside iCalendar

| Metadata                      | Storage and identity                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Room/calendar binding         | Validated static configuration or app-owned PostgreSQL binding rows; only ready dynamic rows grant access       |
| Matrix reminder configuration | App-owned PostgreSQL, keyed by room, calendar, event UID, optional recurrence identity, and alarm UID           |
| Reminder delivery claim       | Stable firing identity and persisted claim state, with a deterministic Matrix transaction ID                    |
| Public-feed share             | Native Radicale read-only token; the gateway signs the externally exposed link with a dedicated operator secret |

Canonical `VALARM` content defines alarm timing. Matrix routing stays separate. The currently merged reminder implementation delivers whole-room mentions for supported timed alarms in unencrypted rooms; all-day scheduling and selected-user delivery are separate pending work. A stored claim does not guarantee exactly-once delivery.

Public sharing is opt-in. Unpublish revokes future access, while downloaded copies remain outside the service's control. Sharing metadata is not a second calendar database. Restore requirements for bindings, reminders, native shares, and signing secrets are documented in [backup/recovery](./backup-recovery.md).

## Where to add a regression

- Domain shapes and validation: [`packages/calendar/src/model/`](../packages/calendar/src/model/) and adjacent tests.
- Recurrence, date semantics, and occurrence identity: [`calendarEventOccurrenceProjection.ts`](../packages/calendar/src/utils/calendarEventOccurrenceProjection.ts) and adjacent tests.
- Repository behavior and explicit errors: [`packages/calendar/src/repository/`](../packages/calendar/src/repository/).
- Original-source preservation and ETags: [`matrix-calendar-server/src/caldav/`](../matrix-calendar-server/src/caldav/) and real-container contracts in [`test/integration/`](../matrix-calendar-server/test/integration/).
- Reusable minimized source examples: [`fixtures/ical/`](../fixtures/ical/README.md).

Keep unsupported properties in preservation fixtures. A test that checks only the fields understood by the UI cannot demonstrate a safe iCalendar round trip.
