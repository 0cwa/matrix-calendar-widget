# Development guide

[Documentation](./README.md) · [Contributing](../CONTRIBUTING.md) · [Architecture](./ARCHITECTURE.md)

Start here to install the repository, find the code for a task, and choose a useful test. The widget, gateway/bot, and shared calendar packages are Yarn workspaces in one repository.

## Install the toolchain

- **Node.js 22.12.0 or newer** for the full development toolchain. CI uses Node 22; use that line when reproducing CI. The server package's production runtime minimum is separately declared as Node 20.
- **Yarn Classic 1.22.x**; the root `packageManager` field pins 1.22.22.
- **Git** for the checkout.
- **Docker with Compose v2, Bash, and curl** only when running the container integration stack. Unit tests and the synthetic browser fixture do not require Docker.

```bash
git clone https://github.com/0cwa/matrix-calendar-widget.git
cd matrix-calendar-widget
corepack enable
yarn install --frozen-lockfile
```

`corepack enable` assumes Corepack is installed with your Node toolchain. If your installation does not include it, install or activate Yarn Classic through your usual toolchain manager. Keep the checked-in lockfile; do not replace it to get around an engine or installation error.

## Get a first result

Run the small domain-model suite from the repository root:

```bash
yarn workspace @matrix-calendar-widget/calendar test:all --runInBand src/model/calendar.test.ts
```

To start the widget's Vite server:

```bash
yarn dev
```

Open the address printed by Vite. A bare browser URL does not provide the Matrix host, room ID, or gateway configuration needed for a working calendar. The deployed app deliberately displays a configuration error when these are missing. For UI work without a Matrix deployment, use component tests or the [synthetic browser fixture](#choose-the-right-test-layer), which explicitly inject an in-memory repository. For a real room, follow [bot and widget setup](./bot-calendar.md) and [configuration](./configuration.md).

## Find the code

| Area                    | Start here                                                                                                                                                                                                            | Responsibility                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Widget startup          | [`AppContainer.tsx`](../matrix-calendar-widget/src/AppContainer.tsx), [`App.tsx`](../matrix-calendar-widget/src/App.tsx)                                                                                              | Matrix host integration, repository selection, calendar route                       |
| Calendar UI             | [`components/calendar/`](../matrix-calendar-widget/src/components/calendar/)                                                                                                                                          | List/grid, calendar controls, event editor/details, reminders, public-feed controls |
| Widget data access      | [`src/calendar/`](../matrix-calendar-widget/src/calendar/)                                                                                                                                                            | Gateway transport, repository, queries/mutations, editor conversion                 |
| Shared domain           | [`packages/calendar/`](../packages/calendar/README.md)                                                                                                                                                                | Calendar/event types, repository interface, validation, occurrence projection       |
| Timezone data           | [`packages/ical-timezones/`](../packages/ical-timezones/README.md)                                                                                                                                                    | Bundled IANA VTIMEZONE data and lookup                                              |
| Gateway API             | [`CalendarGatewayController.ts`](../matrix-calendar-server/src/controller/CalendarGatewayController.ts), [`guard/`](../matrix-calendar-server/src/guard/), [`middleware/`](../matrix-calendar-server/src/middleware/) | HTTP input, identity, authorization, request limits                                 |
| CalDAV and iCalendar    | [`src/caldav/`](../matrix-calendar-server/src/caldav/)                                                                                                                                                                | Discovery, bounded transport, ETags, preservation-first parsing and patching        |
| Room operations and bot | [`src/service/`](../matrix-calendar-server/src/service/), [`src/rpc/`](../matrix-calendar-server/src/rpc/)                                                                                                            | Membership/power policy, bindings/setup, commands, Matrix delivery                  |
| Reminders               | [`src/reminder/`](../matrix-calendar-server/src/reminder/)                                                                                                                                                            | Canonical alarm checks, durable configuration/claims, bounded scheduler             |
| Public feeds            | [`service/public-feed/`](../matrix-calendar-server/src/service/public-feed/)                                                                                                                                          | Publication, signed public links, canonical Radicale feed validation                |
| Radicale integration    | [`radicale-auth/`](../radicale-auth/README.md)                                                                                                                                                                        | Project-owned OpenID authentication module and image                                |
| Fixtures and acceptance | [`fixtures/ical/`](../fixtures/ical/README.md), [`dev/`](../dev/README.md), [`e2e/`](../e2e/README.md)                                                                                                                | Preserved ICS samples, local services, browser and real-client harnesses            |

Normal widget startup is calendar-only. Some inherited meeting modules and server services remain for compatibility or planned retirement. Read the [legacy entry-point inventory](./legacy-entry-points.md) and [server inventory](./legacy-server-inventory.md) before modifying or deleting them. A package name or an old directory alone does not establish that code is unused.

## Run focused checks

All examples run from the repository root. Use the relevant workspace instead of waiting for the whole repository on every edit.

Before focused widget checks, build the shared packages in dependency order, as CI does. Their `lib` outputs are generated from this checkout's source; if a shared package is missing or appears stale, check `node --version` and `yarn --version` against the [toolchain requirements above](#install-the-toolchain), then use `yarn workspaces info` to inspect the declared workspace map before rebuilding these packages. Do not reuse generated output from another checkout. When UI or translation catalog paths change, run the translation check before the affected widget tests:

```bash
yarn workspace @matrix-calendar-widget/ical-timezones build
yarn workspace @matrix-calendar-widget/calendar build
yarn workspace @matrix-calendar-widget/widget translate --ci --dry-run
```

```bash
# Widget interaction and transport tests (Vitest)
yarn workspace @matrix-calendar-widget/widget test:all src/components/calendar/CalendarHome.test.tsx
yarn workspace @matrix-calendar-widget/widget tsc
yarn workspace @matrix-calendar-widget/widget lint

# Gateway, CalDAV, and bot tests (Jest)
yarn workspace @matrix-calendar-widget/server test:all --runInBand src/caldav/ICalendarEventCodec.test.ts
yarn workspace @matrix-calendar-widget/server exec -- tsc --noEmit
yarn workspace @matrix-calendar-widget/server lint

# Shared calendar model and recurrence (Jest)
yarn workspace @matrix-calendar-widget/calendar test:all --runInBand
yarn workspace @matrix-calendar-widget/calendar lint
```

The widget's `test` command starts Vitest watch mode; the server and shared packages' `test` commands start Jest watch mode. Use `test:all` for a finite run. Add the smallest regression that demonstrates a bug, especially for recurrence, timezone, unknown-property preservation, authorization, and stale-ETag behavior.

## Choose the right test layer

| Layer                            | How to run or locate it                                                                                                                                       | What it establishes                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Unit/component tests             | Workspace `test:all`; tests sit next to source, with additional server tests in `matrix-calendar-server/test/`                                                | Domain, transport, authorization, and UI behavior under controlled fixtures                      |
| ICS fixtures                     | [Fixture index](../fixtures/ical/README.md), codec and projection tests                                                                                       | Supported serialization, round trips, recurrence, and opaque-data preservation                   |
| Synthetic calendar browser tests | [Browser validation guide](./browser-calendar-validation.md), `playwright.calendar.config.ts`                                                                 | Rendered calendar layout, keyboard/focus behavior, axe checks, and bounded synthetic performance |
| Real Matrix/CalDAV contracts     | [Local services](../dev/README.md), [CalDAV workflow](../.github/workflows/caldav-contract.yml)                                                               | Gateway and principal contracts against pinned Synapse/Radicale services                         |
| PostgreSQL contracts             | Server `test:postgres-contract`, `test:postgres-binding-contract`, `test:postgres-coexistence-contract`; setup in [CI](../.github/workflows/ci.yml)           | Durable reminder/binding behavior and recovery against a configured test database                |
| Actual Element Web/Desktop       | [E2E guide](../e2e/README.md), [client-validation guide](./calendar-client-validation.md), [acceptance workflow](../.github/workflows/element-acceptance.yml) | The real widget host and selected application candidate, under the recorded fixture scope        |
| Release and operator acceptance  | [Release ledger](./RELEASE.md), [beta scope](./beta-scope.md)                                                                                                 | Evidence tied to an exact source commit, images, deployment target, backup and recovery          |

External-service contracts can be skipped when their environment variables are absent. A green unit test run therefore does not imply that CalDAV or PostgreSQL contracts ran. `yarn test:all` also does not launch the Playwright suites.

For the synthetic browser lane:

```bash
yarn workspace @matrix-calendar-widget/ical-timezones build
yarn workspace @matrix-calendar-widget/calendar build
yarn workspace e2e playwright install --with-deps chromium --only-shell
yarn workspace e2e playwright test --config playwright.calendar.config.ts
```

The browser installation may need system-package privileges on Linux. The [browser validation guide](./browser-calendar-validation.md) includes fixture type checks and explains the evidence limits.

## Run the repository gate

```bash
yarn ci
```

This runs documentation checks and their regressions, formatting, dependency checks, lint, configured workspace type checks, shared-package builds, non-interactive unit tests, and builds. The [CI workflow](../.github/workflows/ci.yml) adds checks such as PostgreSQL contracts, deployment validation, and package-content checks. Keep all protected contexts and the integration contracts relevant to your change; focused local checks are an editing aid.

Useful individual commands:

| Command               | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `yarn docs:check`     | Check local documentation paths and heading anchors without network access |
| `yarn docs:test`      | Test the documentation validator                                           |
| `yarn prettier:check` | Check formatting                                                           |
| `yarn prettier:write` | Format the repository; review the resulting diff                           |
| `yarn lint`           | Lint workspaces                                                            |
| `yarn tsc`            | Run configured workspace type-check scripts                                |
| `yarn test:all`       | Run workspace unit suites without watch mode                               |
| `yarn build`          | Build workspaces, including server TypeScript compilation                  |
| `yarn depcheck`       | Check declared dependency usage                                            |

For a small formatting fix, run Prettier on the changed paths instead of rewriting unrelated files. Generated timezone data has its own [update procedure](./timezones-ical-data.md).

## Common setup problems

| Symptom                                                | First check                                                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Yarn rejects an engine version                         | Compare `node --version` with the root Node requirement; workspace runtime minima do not describe the whole development toolchain |
| Widget displays “Calendar configuration is incomplete” | Supply the Matrix room and gateway configuration through a real host, or use the explicit test fixture                            |
| Compiled shared package is missing                     | Build `@matrix-calendar-widget/ical-timezones`, then `@matrix-calendar-widget/calendar`                                           |
| A contract suite reports skipped tests                 | Read its environment prerequisites and corresponding workflow; starting Docker alone does not enable every contract               |
| Playwright cannot find Chromium                        | Install the browser from the locked `e2e` workspace with the command above                                                        |
| A legacy meeting E2E case fails                        | Confirm that you intended to run the inherited harness; use the dedicated calendar configs for current calendar work              |

Before opening a PR, follow [Contributing](../CONTRIBUTING.md). Before choosing a new workstream, check the [roadmap](./ROADMAP.md). Release qualification is tracked separately from everyday development in the [release ledger](./RELEASE.md).
