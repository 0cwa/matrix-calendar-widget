# Matrix Calendar Widget

> **Status: pre-alpha.** This repository is a hard fork of Nordeck's NeoDateFix / `matrix-meetings` project and is being converted into a Matrix-first team calendar backed by CalDAV/Radicale.

The primary product is a responsive Matrix widget for Element and other widget-capable clients. It should let teams manage shared calendars, events, recurrence, attendees, alarms, and calendar collections without falling back to Radicale's generic collection UI. A Matrix bot provides notifications and a command fallback for clients that cannot render widgets.

## Product principles

- **The widget is the product.** Commands are a compatibility fallback, not a parallel UI.
- **CalDAV is canonical.** Radicale remains the source of truth for calendars and iCalendar objects.
- **Create simple collections.** Calendars created by this project are VEVENT-only. Existing mixed collections are tolerated and preserved.
- **Do not surface dead complexity.** VJOURNAL is not a first-class feature. VTODO may become a separate task-list feature later.
- **Preserve interoperability.** Editing an event must not silently discard iCalendar properties the widget does not understand.
- **Matrix identity, not Matrix passwords.** The widget authenticates to our gateway using Matrix widget/OpenID flows. It must never ask users for their Matrix password.
- **Matrix-native notifications.** Reminder delivery uses normal Matrix messages and `m.mentions`, including optional `@room` where permitted.
- **Track MSC4496 without depending on it.** Our domain model should map cleanly to the proposal while it remains unstable.

## Current state

M0 fork hygiene is merged. On `main`, the calendar domain and repository seam, repository-backed calendar/list read paths, mutation hooks, Matrix-authenticated calendar gateway context, Matrix room authorization policy, and the Radicale OpenID delegation contract are implemented.

The primary repository-backed event create/edit/delete UI is implemented in PR #40 and is the remaining M1 slice. M2 is active: PR #52 retains validated OpenID credentials request-locally and PR #53 adds the CalDAV discovery client. The end-to-end Radicale path still needs the credential bridge (#55), configured discovery endpoint (#56), OpenID-capable `radicale-auth-matrix` support (#48), and real-container contract tests (#45).

Inherited NeoDateFix meeting-room paths remain only where migration has not yet reached them. Historical changelogs, NOTICE files, and upstream provenance intentionally retain NeoDateFix/Nordeck names. See [docs/STATUS.md](./docs/STATUS.md) for the current execution order and active PR blockers.

## Start here

- [AGENTS.md](./AGENTS.md) — rules for humans and coding agents
- [Architecture](./docs/ARCHITECTURE.md)
- [Implementation plan](./docs/PLAN.md)
- [Current project status](./docs/STATUS.md)
- [Roadmap](./docs/ROADMAP.md)
- [Development guide](./docs/DEVELOPMENT.md)
- [Upstream provenance](./docs/UPSTREAM.md)
- [Architecture decisions](./docs/adrs/)

## Development

Node.js 22 and Yarn 1.22 are recommended.

```bash
corepack enable
yarn install --frozen-lockfile
yarn ci
yarn dev
```

For Matrix/Radicale integration work, start the pinned local services with `yarn dev:services:up`. See [dev/README.md](./dev/README.md).

## Upstream

Baseline imported from:

- Repository: `nordeck/matrix-meetings`
- Commit: `2d3011f665af04c3cd376c388f7ae3bcb06bba25`
- Import commit in this repository: `387a3292d1a1ffce4d109762608d421f79ba1392`

See [docs/UPSTREAM.md](./docs/UPSTREAM.md) before attempting an upstream sync.

## License

Apache License 2.0. The original Nordeck copyright, NOTICE files, and attribution must be retained for inherited code as required by the license.
