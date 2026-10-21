# Gateway and bot workspace

[Project overview](../README.md) · [Development guide](../docs/DEVELOPMENT.md) · [Architecture](../docs/ARCHITECTURE.md) · [Configuration](../docs/configuration.md)

`@matrix-calendar-widget/server` is the NestJS calendar gateway and Matrix bot. It validates Matrix identity and permissions, talks to CalDAV, handles bounded `!calendar` commands, and hosts optional room setup, reminder, and public-feed services. Radicale remains the canonical calendar store.

## Run locally

Install dependencies from the repository root. Configure a disposable Matrix/Radicale environment using [local services](../dev/README.md) and the [configuration reference](../docs/configuration.md). The server reads environment variables and local `.env.local`, `.env.dev`, or `.env` files in its workspace; keep real credentials out of Git.

Build the shared packages and start the server in watch mode:

```bash
yarn workspace @matrix-calendar-widget/ical-timezones build
yarn workspace @matrix-calendar-widget/calendar build
yarn workspace @matrix-calendar-widget/server start:dev
```

The workspace start scripts set port 3001. Starting the process requires valid service configuration; it does not create a complete production deployment or automatically enable room features. For packaged operation, use [the deployment guide](../docs/deployment-docker.md).

## Find the code

| Path                                                                         | Responsibility                                                               |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`src/index.ts`](./src/index.ts), [`src/app.module.ts`](./src/app.module.ts) | Process bootstrap, dependency wiring, Matrix listeners                       |
| [`src/configuration.ts`](./src/configuration.ts)                             | Environment parsing and defaults                                             |
| [`src/controller/`](./src/controller/)                                       | Gateway, public-feed, reminder, and retained compatibility HTTP routes       |
| [`src/guard/`](./src/guard/), [`src/middleware/`](./src/middleware/)         | Matrix identity/membership, request policy, traffic bounds                   |
| [`src/caldav/`](./src/caldav/)                                               | Discovery, HTTP transport, conditional writes, iCalendar codec               |
| [`src/service/`](./src/service/)                                             | Room authorization, principal selection, bindings, setup, bot commands       |
| [`src/service/public-feed/`](./src/service/public-feed/)                     | Opt-in publication and canonical public ICS delivery                         |
| [`src/reminder/`](./src/reminder/)                                           | Alarm validation, configuration, PostgreSQL claims, scheduler and transports |
| [`test/integration/`](./test/integration/)                                   | Real Synapse/Radicale contracts                                              |

Tests also sit beside the implementation and in [`test/`](./test/). The [data model](../docs/data-model.md) explains identifiers, timing, and preservation rules.

## Runtime boundaries

- Personal calendar operations use the authenticated user's validated OpenID proof. Room operations recheck actor permissions and the exact binding before using the selected server-side principal.
- Room access, event writes, setup, reminder configuration/delivery, action notices, and public publication are separately configured capabilities. See [configuration](../docs/configuration.md) for defaults and prerequisites.
- `!calendar help` documents supported fallback commands. The optional exact `!calendar setup` command creates a binding only after the configured store and authorization/widget prerequisites pass. See [bot setup](../docs/bot-calendar.md).
- Native scheduled reminders currently support whole-room mentions in unencrypted rooms. A configured database alone does not enable delivery.
- Inherited `/v1/meeting/*` routes and meeting RPC handlers are disabled for the calendar pilot. The legacy welcome workflow and private error-room notifications are off by default; `!meeting setup` remains disabled. Retained compatibility flags do not replace the calendar setup flow.

The [legacy entry-point](../docs/legacy-entry-points.md) and [server inventories](../docs/legacy-server-inventory.md) describe what remains and why. Do not infer that every registered provider is part of normal calendar use.

## Workspace commands

Run from the repository root with `yarn workspace @matrix-calendar-widget/server <command>`:

| Command                              | Purpose                                                           |
| ------------------------------------ | ----------------------------------------------------------------- |
| `start`                              | Build, then start the configured service on port 3001             |
| `start:dev` / `start:debug`          | Start with watch mode / debugger and watch mode                   |
| `test`                               | Jest watch mode                                                   |
| `test:all`                           | Finite Jest run with coverage; accepts file filters               |
| `exec -- tsc --noEmit`               | Type-check server source without emitting files                   |
| `lint`                               | ESLint with no warnings allowed                                   |
| `build`                              | Compile to `lib/`, copy assets/locales, and check packaged assets |
| `test:postgres-contract`             | Reminder-store contract against configured PostgreSQL             |
| `test:postgres-binding-contract`     | Dynamic-binding store contract against configured PostgreSQL      |
| `test:postgres-coexistence-contract` | Shared binding/reminder database and recovery contract            |
| `translate`                          | Extract and synchronize translation keys                          |
| `depcheck`                           | Check dependency usage                                            |
| `generate-disclaimer`                | Add license/NOTICE information after building                     |
| `docker:build`                       | Build the server image from prepared outputs                      |

Database and CalDAV contracts require their fixture environment; absent configuration can cause a suite to skip. The [testing map](../docs/DEVELOPMENT.md#choose-the-right-test-layer) and [CI workflow](../.github/workflows/ci.yml) describe the complete checks. The current server image uses Node 22; the package manifest declares a runtime minimum of Node 20, while full-repository development requires Node 22.12 or newer.
