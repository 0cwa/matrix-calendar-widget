# NeoDateFix migration inventory

This is a coarse migration map for the hard fork. It is deliberately architectural rather than file-by-file; update it as responsibilities move.

## Keep and reuse aggressively

These areas solve problems the fork still has:

- Matrix Widget API / Matrix Widget Toolkit initialization and capability plumbing.
- Element-compatible MUI theming and layout patterns.
- Vite/React application shell.
- FullCalendar integration as a **view layer**.
- common date/time picker components.
- recurrence editor interaction patterns.
- Matrix room-member selection UI.
- localization/i18next infrastructure.
- accessibility and widget test utilities.
- Vitest/Jest/Playwright test scaffolding.
- Docker/widget-server patterns after fork-owned image names are introduced.
- the NestJS server shell as the starting deployable for gateway + bot.

“Keep” does not mean the types/API are permanent. Keep the behavior and tested UI unless the target architecture requires a seam.

## Adapt behind new domain seams

### Widget calendar surfaces

Inherited:

- `MeetingsCalendar`
- `MeetingsList`
- `MeetingsFilter`
- `MeetingsNavigation`
- `MeetingsToolbar`
- `MeetingCard`
- `MeetingDetails`
- `ScheduleMeetingModal`

Direction:

- replace meeting entities with calendar-domain events,
- source data from `CalendarRepository`/gateway APIs,
- keep responsive and accessibility behavior,
- expand the editor to normal VEVENT fields.

### Calendar utility package

Inherited `packages/calendar` contains useful recurrence/date logic.

Direction:

- audit semantics against RFC 5545 and real ICS fixtures,
- separate generic calendar-domain logic from NeoDateFix meeting assumptions,
- add round-trip and DST regression coverage,
- rename only during M0 fork hygiene.

### Redux/API layer

Inherited `meetingsApi` and selectors encode Matrix meeting-room persistence.

Direction:

- introduce calendar API/repository interfaces,
- migrate selectors/view models incrementally,
- remove Matrix meeting event dependencies after the UI is fully routed through the new seam.

### Server / bot

Inherited NestJS bot has useful Matrix lifecycle, logging, configuration, and test patterns.

Direction:

- become the calendar gateway + notification bot,
- add Matrix OpenID validation,
- add room authorization policy,
- add CalDAV repository,
- add durable reminder scheduler,
- retain commands only as fallback.

### E2E

Keep the Playwright/Testcontainers approach.

Direction:

- replace meeting-room scenarios with Synapse + Radicale calendar scenarios,
- preserve accessibility coverage,
- add another CalDAV client or direct CalDAV assertions for interoperability checks.

### Docker / Helm

Keep as reference only until renamed and redesigned.

Direction:

- do not publish inherited targets,
- eventually produce fork-owned widget and gateway images,
- add Radicale integration examples without assuming Radicale must be bundled.

## Retire once replacement paths exist

The following are NeoDateFix product concepts, not target Matrix Calendar Widget concepts:

- automatic creation of a Matrix room per meeting,
- meeting-space hierarchy used solely to organize generated meeting rooms,
- breakout-session creation/management,
- meeting-room widget copying/selection,
- Jitsi/Etherpad/Whiteboard defaults tied to generated meeting rooms,
- meeting-room cockpit behavior that has no general calendar use,
- APIs whose only purpose is third-party creation of NeoDateFix meeting rooms.

Do not delete these all at once. Remove each area after tests demonstrate that the new calendar path no longer depends on it.

## Review before deleting

Some meeting-specific components may contain generally useful UI or Matrix patterns even if the feature is retired. Before deletion:

1. search for reusable primitives,
2. move generic behavior into `common` or a new domain-neutral module,
3. add tests around the extracted behavior,
4. delete the obsolete feature in the same or a follow-up PR.

## Naming migration

Inherited names are intentionally present in the baseline:

- `matrix-calendar-widget`
- `matrix-calendar-server`
- `@nordeck/matrix-meetings-*`
- NeoDateFix user-facing strings

M0 owns renaming. Functional feature PRs should not opportunistically rename unrelated modules because it makes review and upstream provenance harder.
