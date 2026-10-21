# Browser and end-to-end tests

[Documentation](../docs/README.md) · [Development guide](../docs/DEVELOPMENT.md) · [Client validation](../docs/calendar-client-validation.md)

This workspace contains several test harnesses with different scopes. For current calendar UI work, start with the synthetic calendar browser suite. For a release candidate, use the dedicated Element Web/Desktop acceptance workflow and its source-bound evidence requirements.

## Choose a harness

| Configuration                                                                                          | Tests                                                                                        | Services                                                                              | Purpose                                                                                        |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`playwright.calendar.config.ts`](./playwright.calendar.config.ts)                                     | [`calendar-tests/`](./calendar-tests/)                                                       | Automatically built Vite fixture; no Docker                                           | Current calendar component layout, keyboard/focus, axe, and synthetic large-calendar rendering |
| [`playwright.element-acceptance.config.ts`](./playwright.element-acceptance.config.ts)                 | [`elementCalendarAcceptance.spec.ts`](./src/elementCalendarAcceptance.spec.ts)               | Prepared Element Web, gateway, widget, Synapse, Radicale, and optional reminder store | Actual hosted widget journey and application contracts                                         |
| [`playwright.element-desktop-acceptance.config.ts`](./playwright.element-desktop-acceptance.config.ts) | [`elementDesktopCalendarAcceptance.spec.ts`](./src/elementDesktopCalendarAcceptance.spec.ts) | Prepared packaged Desktop and isolated acceptance services                            | Actual Desktop widget journey with its own startup and evidence requirements                   |
| [`playwright.config.ts`](./playwright.config.ts)                                                       | Inherited meeting suites in [`src/`](./src/)                                                 | Legacy Testcontainers setup and prepared widget/server images                         | Historical meeting, breakout, and compatibility coverage                                       |

The root `yarn e2e` command selects the **inherited default configuration**. It is not the current calendar acceptance shortcut. Also, `yarn test:all` does not execute Playwright: this workspace's `test:all` script is a placeholder. Select the required configuration explicitly.

## Run the synthetic calendar suite

From the repository root, after dependency installation:

```bash
yarn workspace @matrix-calendar-widget/ical-timezones build
yarn workspace @matrix-calendar-widget/calendar build
yarn exec -- tsc -p matrix-calendar-widget/browser-tests/tsconfig.json --noEmit
yarn exec -- tsc -p e2e/calendar-tests/tsconfig.json --noEmit
yarn workspace e2e playwright install --with-deps chromium --only-shell
yarn workspace e2e playwright test --config playwright.calendar.config.ts
```

The configuration builds the fixture and starts its own Vite preview on port 4174. Do not run another server on that port. It uses deterministic synthetic data and an in-memory repository; no Matrix login, gateway, real CalDAV store, or Matrix notification delivery is involved.

To run a narrower layout check, append `calendar-layout.spec.ts` to the final command. Browser installation may need system-package privileges on Linux. Failure outputs go to `e2e/calendar-test-results/`; traces are disabled. See [browser validation](../docs/browser-calendar-validation.md) for dimensions, coverage, and interpretation.

## Run actual Element acceptance

Use the checked-in [Element acceptance workflow](../.github/workflows/element-acceptance.yml), [local service/harness guide](../dev/README.md), and [client-validation procedure](../docs/calendar-client-validation.md). The Playwright configurations alone do not provision accounts, bindings, images, secrets, Desktop, or the stack. The workflow and helpers define those inputs and the corresponding cleanup.

Bind results to the exact application commit and client/image versions. Keep sanitized summaries and the required cleanup evidence; do not enable raw traces, video, or screenshots that may capture identity proofs or private calendar data. The actual-client configs deliberately disable those capture modes.

The [beta scope](../docs/beta-scope.md) defines which journeys are required. The [release ledger](../docs/RELEASE.md) records accepted evidence and remaining gates. Component-layout success does not substitute for real Element embedding, and a previously qualified source tree does not qualify later changes automatically.

## Legacy meeting harness

The default `playwright.config.ts` retains inherited meeting, breakout, and related fixtures. Normal calendar startup no longer exposes those meeting routes, and inherited meeting HTTP/RPC operations are disabled for the pilot. Use these suites only when working on a retained compatibility path and interpret failures against the [legacy entry-point inventory](../docs/legacy-entry-points.md).

Its [`src/deploy/`](./src/deploy/) helpers use Docker/Testcontainers and locally prepared `0cwa/matrix-calendar-widget` / `0cwa/matrix-calendar-server` images. This setup is separate from the current calendar acceptance Compose stack. Do not weaken current calendar, authorization, preservation, or cleanup gates to make an obsolete meeting scenario pass. Future pruning follows the [roadmap](../docs/ROADMAP.md).

## Workspace maintenance

```bash
yarn workspace e2e lint
yarn workspace e2e depcheck
```

Use the repository-locked Playwright version through `yarn workspace e2e playwright ...` so browser binaries and the runner agree. When changing harness helpers in `dev/`, run their adjacent Node tests as well as the affected browser lane. Keep failures attributable to setup, application behavior, or test assertions; a timed-out navigation is not automatically a flaky test.
