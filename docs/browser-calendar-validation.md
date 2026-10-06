# Browser validation for calendar components

The separate **Calendar browser layout** CI job exercises the production
calendar list, month grid, toolbar, and event details in Chromium with
synthetic, in-memory repositories. It uses the repository-locked Playwright and
axe dependencies and a separate production build served by Vite preview.
There is no Matrix client, gateway connection, real calendar
data, credential, or notification delivery in this fixture. The hosted
Chromium job passed all eight cases at the exact tested source tree
`c368aacfb32a5b9b57bcb964cb119bdacd20b243` (PR #195; merged as
`c9153aab54f139aa68ad9ebae028c073c9458841`).

The eight layout cases cover list and month views at 320 × 640, 390 × 844,
768 × 1024, and 1280 × 800 CSS pixels. They measure document and calendar
surface widths, check long text for clipping, open event details with the
keyboard after verifying Tab reachability, measure dialog widths, run axe,
verify keyboard scrolling in the details content, close with Escape, and confirm
focus returns to the event. Dimensions and failure screenshots are retained as
synthetic CI diagnostics for seven days. Browser traces and video are disabled.

Two additional 320 × 640 cases use the production `CalendarToolbar`,
`CalendarEventsSurface`, event details, and reminder control with a synthetic
room-capability repository. The read-only case checks disabled event-write
controls, read-only details, and the safe current-room link. The manager case
checks the bound “Room calendar” label in the event editor, enabled create/edit/
delete controls, the room link, and an opt-in reminder setting whose saved
state reloads from the synthetic repository. Both check document and dialog
overflow, keyboard focus return, page errors, and axe. The repository is
deterministic and in-memory; the smoke does not save calendar events or deliver
reminders, and it does not simulate Matrix authorization, gateway enforcement,
CalDAV persistence, or a live Matrix client.

The fixture uses a default MUI theme, English text, a fixed Stockholm timezone,
and synthetic long titles, locations, and descriptions. It validates those
components and inputs only. It does not establish that a Matrix client embeds
the widget, approves capabilities, forwards keyboard input, supports a screen
reader, or uses the same fonts/theme. The actual Element Web, Desktop, Android,
and iOS checks in the client validation record remain separate release gates.

Run the checks from a clean checkout:

```bash
yarn install --frozen-lockfile
yarn workspace @matrix-calendar-widget/ical-timezones build
yarn workspace @matrix-calendar-widget/calendar build
yarn exec -- tsc -p matrix-calendar-widget/browser-tests/tsconfig.json --noEmit
yarn exec -- tsc -p e2e/calendar-tests/tsconfig.json --noEmit
yarn workspace e2e playwright install --with-deps chromium --only-shell
yarn workspace e2e playwright test --config playwright.calendar.config.ts
```

The local validation environment could not download the Chromium executable.
Source type checks, lint, and test discovery were run locally; the hosted
Chromium result above supplies standalone component-layout evidence only. It
does not replace the actual-client and screen-reader checks in the client
validation record.
