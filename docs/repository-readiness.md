# Repository and operator readiness

[Documentation](./README.md) · [Project status](./STATUS.md) · [Release ledger](./RELEASE.md) · [Pilot scope](./beta-scope.md)

Use this page to understand the kinds of evidence needed before operating the calendar. The [release ledger](./RELEASE.md) records the actual pass/fail/blocked state and exact source; this guide does not duplicate those changing results.

## Three different questions

| Question                                                  | Evidence that answers it                                                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the implementation behave as intended?               | Focused tests, preservation fixtures, types, lint, builds, and applicable real-service contracts.                                                   |
| Does a particular candidate work in the approved clients? | Source-bound Element Web/Desktop acceptance, permission and conflict journeys, keyboard/focus, performance, reminders, and restart/restore checks.  |
| Can this installation be operated and recovered?          | Target-specific identity/network/secret configuration, live canaries, actual backups, isolated restore, disable/rollback, and recovery-key custody. |

The frozen candidate has recorded application and hosted rehearsal evidence. Newer `main` commits need their own qualification when selected as a candidate. The public target record still reports stopped services and outstanding operator/recovery work. Follow the ledger for those source-bound details.

## Where to validate each boundary

| Boundary               | Operator or reviewer needs to establish                                                                                         | Guide                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Matrix identity        | Correct homeserver, server name, OpenID userinfo origin, credentials, and secret-safe logs                                      | [Configuration](./configuration.md), [threat model](./threat-model.md)                     |
| Room access            | Intended principal mode, membership/power checks, exact bindings, and independent capability gates                              | [Room setup](./bot-calendar.md), [architecture](./ARCHITECTURE.md)                         |
| CalDAV data            | Correct owned store, preserved mixed/unknown content, conditional writes, and representative synthetic fixtures                 | [Data model](./data-model.md), [client validation](./calendar-client-validation.md)        |
| Reminders and bindings | Separate PostgreSQL state, selected schema versions, default-off gates, and one-replica assumptions                             | [Deployment](./deployment-docker.md), [upgrade guide](./upgrade-migration.md)              |
| Public subscriptions   | Explicit consent, VEVENT-only content, public GET/HEAD ingress, secret-safe logging, revocation, and share/signing-key recovery | [Public-feed deployment](./deployment-docker.md#public-calendar-feed-ingress-and-recovery) |
| Clients and capacity   | Approved client versions, side-panel behavior, bounded pilot timings, and known unsupported source forms                        | [Beta scope](./beta-scope.md), [performance](./calendar-performance.md)                    |
| Recovery               | Paired canonical/application data, required runtime inputs and keys, isolated restore, and rollback evidence                    | [Backup and recovery](./backup-recovery.md)                                                |
| Release                | Exact source, required checks, accepted images, and recorded scope/decision                                                     | [Release ledger](./RELEASE.md), [versioning](./release-versioning.md)                      |

The bounded baseline uses an independent project-owned Radicale store. Reusing an existing managed service or its data requires additional compatibility and recovery evidence. Do not interpret a passing pinned-service contract as proof that another deployment is interchangeable.

## Historical snapshot

The [6 October 2026 readiness matrix](./archive/readiness-2026-10-06.md) is retained for its original source and observations. Its old pending tasks are not a second current release checklist.
