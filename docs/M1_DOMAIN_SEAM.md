# M1 domain seam

M1 replaces the inherited meeting-room persistence boundary incrementally while keeping the tested calendar UI and recurrence utilities.

## Reuse the existing recurrence layer

`packages/calendar` already contains iCalendar-oriented recurrence primitives such as `CalendarEntry`, RRULE parsing/expansion, exclusions, and instance overrides.

These remain useful and should not be rewritten merely to introduce the product domain.

## Product domain

The new `Calendar` and `CalendarEvent` types are intentionally independent of:

- FullCalendar,
- Redux,
- Matrix room events,
- CalDAV/WebDAV wire responses.

Timed event values retain a local ISO date/time plus named IANA timezone. All-day timing is a separate discriminated form with an exclusive end date.

This mirrors calendar semantics rather than a rendering library's event shape and maps cleanly to both iCalendar and the MSC4496 direction.

## Migration order

1. Product domain types — #25.
2. `CalendarRepository` plus in-memory implementation — #26.
3. Repository-backed widget read paths — #27.
4. Repository-backed create/edit/delete — #28.
5. Add CalDAV/gateway adapters in M2/M3.

## Guardrail

Do not globally rename the inherited `Meeting` type to `CalendarEvent`.

`Meeting` currently includes Matrix room identity, room hierarchy, room widgets, meeting participants, and deletion state. Those concepts must not leak into the canonical calendar domain.
