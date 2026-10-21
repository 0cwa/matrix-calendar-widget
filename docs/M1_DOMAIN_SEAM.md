# M1 domain seam: implementation history

[Documentation](./README.md) · [Current data model](./data-model.md) · [Architecture](./ARCHITECTURE.md)

> **Historical design note.** M1 is complete. This page records the original migration seam and sequence; use the linked source interfaces and current guides for new work.

## Why the seam was introduced

The first calendar milestone replaced inherited meeting-room persistence incrementally while keeping useful calendar UI and recurrence utilities. It introduced `Calendar`, `CalendarEvent`, and `CalendarRepository` independently of FullCalendar, Redux, Matrix room events, and CalDAV wire responses.

`packages/calendar` already contained iCalendar-oriented recurrence primitives such as `CalendarEntry`, rule expansion, exclusions, and instance overrides. These were reused rather than rewritten merely to introduce the product domain.

## Completed migration sequence

1. Product domain types — #25.
2. `CalendarRepository` and in-memory implementation — #26.
3. Repository-backed widget read paths — #27.
4. Repository-backed create/edit/delete — #28, completed through PR #40.
5. Gateway and CalDAV adapters — the subsequent M2/M3 work in [implementation history](./PLAN.md).

The current [`CalendarRepository`](../packages/calendar/src/repository/calendarRepository.ts), [`GatewayCalendarRepository`](../matrix-calendar-widget/src/calendar/GatewayCalendarRepository.ts), and [data model](./data-model.md) have evolved beyond this initial milestone. Timed endpoints now preserve floating or zoned values; all-day events retain exclusive end dates.

## Boundary that still applies

Do not globally rename the inherited `Meeting` type to `CalendarEvent`. Meeting-room identity, hierarchy, widgets, participants, and deletion state are different concepts from a canonical calendar event. Preserve useful shared primitives without importing that meeting-business model into new calendar interfaces.

The normal widget startup and routing cleanup is recorded in the [roadmap](./ROADMAP.md). Remaining legacy source is described in the [entry-point inventory](./legacy-entry-points.md).
