# Matrix Calendar Widget

> **Status: pre-alpha.** This repository is a hard fork of Nordeck's NeoDateFix / `matrix-meetings` project and is being converted into a Matrix-first team calendar backed by CalDAV/Radicale.

The primary product is a responsive Matrix widget for Element and other widget-capable clients. It should let teams manage shared calendars, events, recurrence, attendees, alarms, and calendar collections without falling back to Radicale's generic collection UI. A Matrix bot is the intended fallback for commands and reminders when widget support is unavailable.

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

M0 fork hygiene, M1's calendar-domain seam, and M3's VEVENT create/edit/delete flow are complete on `main`, including ETag conflict recovery and real Radicale interoperability coverage.

M2 identity and CalDAV discovery is complete on the pinned development stack. PR #146 closed #48 with the project-owned OpenID-only Radicale image, and PR #147 closed #45 with the real-container personal-actor gateway contract. The owned backend accepts tagged Matrix OpenID proofs and rejects untagged credentials; Matrix-password CalDAV login is unsupported. These contracts do not verify the etke-host image override or preservation of its existing `/data` store.

M4 on `main` includes calendar creation, visibility, rename, deletion, description and color editing, mixed-collection safeguards, and manager-only CalDAV diagnostics. Collection-timezone editing remains deferred. M7 currently provides localized `!calendar help` and directs capable clients to the widget; event queries and data-changing commands remain open.

[ADR010](./docs/adrs/adr010-mixed-calendar-principal-model.md) keeps personal widget calendars user-scoped and separates them from room-owned bot calendars under an application principal. M2 #48/#45 covers personal-actor OpenID delegation, same-user enumeration, and fail-closed denial; it does not validate the separate appservice identity or room isolation required by M6 issue #7. ADR024 defines that appservice proof, and the personal-actor proof is never used as the room calendar's CalDAV identity. Room-owned reads and writes remain blocked until issue #7's authorization and cross-room-isolation contracts pass and the operator's image/data path is validated. M5 remains active; M6 reminder storage primitives do not enable scheduling or delivery; and M8 build checks and deployment documentation do not verify an operator-hosted deployment.

Inherited NeoDateFix meeting-room paths remain only where migration has not yet reached them. Historical changelogs, NOTICE files, and upstream provenance intentionally retain NeoDateFix/Nordeck names. See [docs/STATUS.md](./docs/STATUS.md) for active blockers and execution order, and [docs/PLAN.md](./docs/PLAN.md) for milestone scope and acceptance criteria.

## Start here

- [AGENTS.md](./AGENTS.md) — rules for humans and coding agents
- [Architecture](./docs/ARCHITECTURE.md)
- [Implementation plan](./docs/PLAN.md)
- [Current project status](./docs/STATUS.md)
- [Security policy](./SECURITY.md)
- [Threat model](./docs/threat-model.md) — current trust boundaries, controls, and open risks
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
