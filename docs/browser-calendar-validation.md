# Browser validation for calendar components

The separate **Calendar browser layout** CI job exercises the production
calendar list, month grid, and event details in Chromium with a synthetic,
in-memory repository. It uses the repository-locked Playwright and axe
dependencies. There is no Matrix client, gateway connection, real calendar
data, credential, or notification delivery in this fixture.

The eight cases cover list and month views at 320 × 640, 390 × 844,
768 × 1024, and 1280 × 800 CSS pixels. They measure document and calendar
surface widths, check long text for clipping, open event details with the
keyboard, measure dialog widths, run axe, close with Escape, and verify focus
returns to the event. Dimensions and failure screenshots are retained as
synthetic CI diagnostics for seven days. Browser traces and video are disabled.

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
yarn exec tsc -p matrix-calendar-widget/browser-tests/tsconfig.json --noEmit
yarn exec tsc -p e2e/calendar-tests/tsconfig.json --noEmit
yarn workspace e2e exec playwright install --with-deps chromium --only-shell
yarn workspace e2e exec playwright test --config playwright.calendar.config.ts
```

The local validation environment could not download the Chromium executable.
Source type checks, lint, and test discovery are local prerequisites; the
hosted browser job must pass before this change is accepted as layout evidence.
