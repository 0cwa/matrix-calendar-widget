# Documentation

[Project overview](../README.md) · [Current status](./STATUS.md) · [Contributing](../CONTRIBUTING.md)

Choose the path that matches what you want to do. You do not need to read the milestone history or architecture decisions before using the calendar or making a small contribution.

## Use the calendar

- [User guide](./user-guide.md): calendars, events, recurring events, reminders, public feeds, and common problems.
- [Room setup and bot commands](./bot-calendar.md): prerequisites, `!calendar setup`, command examples, and permissions.
- [Private calendar app access](./private-calendar-app-access.md): external CalDAV access included in this change; default-off pending operator qualification.
- [Feature status](./STATUS.md): what is merged, what is in development, and known limits.
- [Free/busy privacy](./free-busy-privacy.md): what calendar information is sensitive and what the product discloses.

## Develop and contribute

1. [Set up a development environment](./DEVELOPMENT.md).
2. [Read the contribution guide](../CONTRIBUTING.md) for change scope, review, tests, and documentation conventions.
3. [Follow the architecture and source map](./ARCHITECTURE.md) to the relevant component.
4. Use the [data model](./data-model.md) and [architecture decision index](./adrs/README.md) when changing a boundary.

| Reference                                                    | What you will find                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| [Widget](../matrix-calendar-widget/README.md)                | Frontend scripts, integration points, and UI tests                    |
| [Server and bot](../matrix-calendar-server/README.md)        | Gateway, Matrix integration, services, and server checks              |
| [Calendar package](../packages/calendar/README.md)           | Domain interfaces, adapters, recurrence, and iCalendar code           |
| [Timezone package](../packages/ical-timezones/README.md)     | Generated timezone data and package usage                             |
| [Timezone maintenance](./timezones-ical-data.md)             | Provenance, regeneration, and update checks                           |
| [iCalendar fixtures](../fixtures/ical/README.md)             | Preservation and interoperability samples                             |
| [Local services](../dev/README.md)                           | Pinned Synapse/Radicale stack and service contracts                   |
| [Browser and E2E tests](../e2e/README.md)                    | Synthetic browser tests, real Element acceptance, and inherited tests |
| [Browser validation](./browser-calendar-validation.md)       | Responsive layout and component evidence                              |
| [Client validation](./calendar-client-validation.md)         | Actual-client acceptance procedure and evidence boundaries            |
| [Calendar performance](./calendar-performance.md)            | Benchmark method, measurements, and limits                            |
| [Timezone performance](./timezone-projection-performance.md) | Projection-specific measurements                                      |
| [Branch protection](./BRANCH_PROTECTION.md)                  | Required checks and merge policy                                      |

## Configure and operate

Start with [deployment](./deployment-docker.md), then use the references relevant to your installation. The [controlled pilot scope](./beta-scope.md) and [release ledger](./RELEASE.md) distinguish checked-in support from source-specific and target-specific acceptance.

| Task                                         | Reference                                             |
| -------------------------------------------- | ----------------------------------------------------- |
| Configure the widget and server              | [Configuration](./configuration.md)                   |
| Understand the owned Radicale integration    | [Radicale authentication](../radicale-auth/README.md) |
| Plan a backup and prove recovery             | [Backup and recovery](./backup-recovery.md)           |
| Upgrade, migrate, or roll back               | [Upgrade and migration](./upgrade-migration.md)       |
| Assess what still needs validation           | [Readiness guide](./repository-readiness.md)          |
| Understand versioning and publication policy | [Release versioning](./release-versioning.md)         |
| Review inherited deployment material         | [Helm chart status](../charts/README.md)              |

## Security and design

- [Security policy](../SECURITY.md): private vulnerability reporting.
- [Threat model](./threat-model.md): trust boundaries, controls, and open risks.
- [CalDAV discovery review](./security-caldav-discovery.md) and [event transport review](./security-caldav-event-transport.md): focused source reviews.
- [Architecture decisions](./adrs/README.md): decisions grouped by topic, with inherited records clearly identified.
- [Legacy entry points](./legacy-entry-points.md) and [server inventory](./legacy-server-inventory.md): retained code and the constraints on retiring it.

## Project direction and history

| Question                                         | Authoritative page                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| What is implemented now?                         | [Status](./STATUS.md)                                                          |
| What should happen next, and why?                | [Roadmap](./ROADMAP.md)                                                        |
| Which milestones and follow-ups are complete?    | [Implementation plan](./PLAN.md)                                               |
| Which source and deployment gates have evidence? | [Release ledger](./RELEASE.md)                                                 |
| What is the bounded pilot meant to prove?        | [Beta scope](./beta-scope.md)                                                  |
| What came from upstream?                         | [Provenance](./UPSTREAM.md) and [migration inventory](./UPSTREAM_INVENTORY.md) |
| Where are earlier milestones and snapshots?      | [Historical archive](./archive/README.md)                                      |

Keep current procedures in the guides above. Put dated measurements and source-bound evidence in their dedicated records instead of expanding the README with a work log. The [documentation conventions](../CONTRIBUTING.md#documentation-conventions) describe how to keep this index and local links current.

## Coding agents

Automation-specific instructions and historical handoffs live in [docs/agents/](./agents/README.md). Human onboarding and project policy are in the contribution and development guides above.
