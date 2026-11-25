# Widget workspace

[Project overview](../README.md) · [Development guide](../docs/DEVELOPMENT.md) · [Configuration](../docs/configuration.md)

`@matrix-calendar-widget/widget` is the React interface embedded in a Matrix client. It uses Matrix Widget Toolkit for host integration, MUI for controls, FullCalendar for the calendar grid, and `CalendarRepository` for data access.

## Start development

Install dependencies once from the repository root, then run:

```bash
yarn dev
```

Vite prints the local URL. For a local HTTPS origin, use:

```bash
yarn workspace @matrix-calendar-widget/widget dev:https
```

The HTTPS command uses a self-signed development certificate. The Matrix client must be able to load and trust that origin.

### Runtime configuration

The deployed widget requires a Matrix room ID (`matrix_room_id`), a gateway URL (`meetings_bot_base_url` widget parameter, falling back to `REACT_APP_API_BASE_URL` when the parameter is absent), and a host that supplies the Widget API/OpenID flow. A missing or blank room ID or gateway value displays an initialization error. It never silently substitutes an ephemeral writable calendar.

The retained `meetings_bot_base_url` parameter is a compatibility name for the calendar gateway. See [configuration](../docs/configuration.md) and [room setup](../docs/bot-calendar.md) for the complete embedding contract. Browser capabilities affect presentation; the gateway enforces authorization.

### UI work without a Matrix deployment

Component tests inject an explicit `InMemoryCalendarRepository`. You can also inspect the synthetic browser fixture:

```bash
yarn workspace @matrix-calendar-widget/ical-timezones build
yarn workspace @matrix-calendar-widget/calendar build
yarn workspace @matrix-calendar-widget/widget vite --config browser-tests/vite.config.ts
```

Open `/browser-tests/index.html` on the address printed by Vite. This fixture demonstrates production calendar components with synthetic data and test host/repository implementations. It does not save to Radicale or prove a real Matrix host works. See the [browser-test guide](../docs/browser-calendar-validation.md) for automated layout checks.

## Find a feature

| Path                                                       | Responsibility                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`src/AppContainer.tsx`](./src/AppContainer.tsx)           | Host/theme integration, gateway configuration, repository injection       |
| [`src/App.tsx`](./src/App.tsx)                             | Calendar home route and redirect from legacy routes                       |
| [`src/calendar/`](./src/calendar/)                         | Gateway repository/transport, query and mutation hooks, editor conversion |
| [`src/components/calendar/`](./src/components/calendar/)   | Calendar controls, list/grid, editor, details, reminders, public feeds    |
| [`src/widgetCapabilities.ts`](./src/widgetCapabilities.ts) | Requested Matrix widget capabilities                                      |
| [`browser-tests/`](./browser-tests/)                       | Standalone synthetic layout/performance fixture                           |

Normal calendar startup no longer initializes inherited meeting Redux/invitation state. Remaining meeting-era modules are documented in the [legacy inventory](../docs/legacy-entry-points.md); check retained imports before removing them.

## Workspace commands

Run these from the repository root with `yarn workspace @matrix-calendar-widget/widget <command>`:

| Command                     | Purpose                                                  |
| --------------------------- | -------------------------------------------------------- |
| `dev` / `dev:https`         | Start Vite with HTTP / development HTTPS                 |
| `test`                      | Watch-mode component/unit tests                          |
| `test:all`                  | Finite Vitest run; accepts file filters                  |
| `tsc`                       | Type-check widget source without emitting files          |
| `lint`                      | ESLint with no warnings allowed                          |
| `build`                     | Build production assets into `dist/`                     |
| `preview` / `preview:https` | Preview the existing production build                    |
| `translate`                 | Extract and synchronize translation keys                 |
| `depcheck`                  | Check dependency usage                                   |
| `generate-disclaimer`       | Add license/NOTICE information to `dist/` after building |
| `docker:build`              | Build the widget image from prepared assets              |

Container and release preparation are described in [deployment](../docs/deployment-docker.md). Review the [contribution guide](../CONTRIBUTING.md) for accessibility, preservation, and PR expectations.
