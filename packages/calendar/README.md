# Shared calendar package

[Documentation](../../docs/README.md) · [Data model](../../docs/data-model.md) · [Development guide](../../docs/DEVELOPMENT.md)

`@matrix-calendar-widget/calendar` contains the calendar domain, repository contracts, validation, and recurrence utilities shared by the widget and server. It is a private workspace package, not a separately published client SDK.

## Where to start

| Path                                                                                                                   | Responsibility                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`src/model/calendar.ts`](./src/model/calendar.ts)                                                                     | Current calendar/event types, timed/all-day values, supported edit shapes |
| [`src/repository/calendarRepository.ts`](./src/repository/calendarRepository.ts)                                       | Repository operations, diagnostics, and explicit error codes              |
| [`src/repository/calendarAuthorization.ts`](./src/repository/calendarAuthorization.ts)                                 | Application authorization interface                                       |
| [`src/repository/inMemoryCalendarRepository.ts`](./src/repository/inMemoryCalendarRepository.ts)                       | Explicit test/demo implementation                                         |
| [`src/utils/calendarEventOccurrenceProjection.ts`](./src/utils/calendarEventOccurrenceProjection.ts)                   | Bounded recurrence projection and occurrence identity                     |
| [`src/model/calendarEntry.ts`](./src/model/calendarEntry.ts), [`src/utils/calendarUtils/`](./src/utils/calendarUtils/) | Retained recurrence primitives from the upstream implementation           |
| [`src/index.ts`](./src/index.ts)                                                                                       | Package exports                                                           |

Current product `CalendarEvent` values and inherited recurrence `CalendarEntry` values serve different roles. Follow the [data model](../../docs/data-model.md) when adding a new calendar operation; do not promote a rendering type or inherited Matrix meeting structure into the domain.

CalDAV HTTP and source-text patching belong to the server's [`caldav/`](../../matrix-calendar-server/src/caldav/) adapter. FullCalendar rendering belongs to the widget. The in-memory repository is injected explicitly in tests/demos and is never a deployed persistence fallback.

## Build and test

From the repository root after dependency installation:

```bash
yarn workspace @matrix-calendar-widget/ical-timezones build
yarn workspace @matrix-calendar-widget/calendar build
yarn workspace @matrix-calendar-widget/calendar test:all --runInBand
yarn workspace @matrix-calendar-widget/calendar lint
```

The build emits CommonJS files to `lib/`; source-aware consumers use the package's source entries. Tests are Jest suites next to source. To run one suite, append its path, for example `src/model/calendar.test.ts`. Use `test` for watch mode.

Recurrence, floating/all-day values, daylight-saving boundaries, and unsupported iCalendar content need preservation-focused regressions. Add reusable minimized ICS samples to [fixtures/ical](../../fixtures/ical/README.md), and exercise the server codec as well when a change affects serialization.
