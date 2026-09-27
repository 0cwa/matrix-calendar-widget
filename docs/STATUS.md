# Project status

_Last updated: 2026-09-27_

This is the short-lived execution snapshot. `docs/PLAN.md` is the durable milestone plan; GitHub issues contain acceptance criteria.

## Current phase

**M3 is complete. M4 now includes safe deletion and description editing; M7 help and M8 Docker build groundwork have merged. The next blockers are distinct user-delegation and room application-principal authentication paths.**

ADR010 / PR #104 selected a mixed principal model: widget calendars remain user-scoped, while the bot MVP uses room-owned calendars under an application principal. Room-owned reads and writes remain blocked until a non-password server-to-Radicale authentication path for that principal is defined and tested. ADR009's user OpenID delegation does not provide application-principal credentials. No etke-managed host deployment has been verified.

## Landed

### M1 — Calendar domain seam

Complete on `main`:

- calendar/event domain model and repository seam,
- in-memory repository,
- repository-backed calendar/list/editor UI,
- create/edit/delete mutation hooks and invalidation.

### M2 — Gateway identity and Radicale discovery

Merged in-repo:

- authenticated calendar gateway context and room membership/power authorization,
- request-scoped Matrix OpenID validation and user-scoped CalDAV credential provider,
- principal/home/calendar discovery,
- password-authenticated real Radicale discovery contract.

The final OpenID-to-Radicale path is still blocked on external plugin work; see **Active blockers**.

### M3 — VEVENT CRUD

Complete on `main`:

- preservation-first `ical.js` codec (#61 / PR #70),
- visible-range transport with ETags and conditional create/update/delete,
- authenticated room-authorized gateway CRUD and gateway-backed widget repository,
- visible conflict recovery,
- real Radicale two-client round-trip and stale-ETag contract (#66 / PR #90).

### M4 — Calendar management

Merged on `main`:

- calendar visibility, VEVENT-only creation, and writable-calendar rename (PRs #94, #96, #99),
- safe VEVENT-only calendar deletion (issue #100 closed by PR #101),
- description discovery and description-only editing through the user-scoped gateway (PR #106).

Calendar color remains open. Calendar timezone editing is deferred. Mixed-collection compatibility notices, hiding unsupported-only collections, and administrator CalDAV URL diagnostics also remain open under #5.

Issue #5 remains open. Its current body is stale: it still lists PR #101 as active and leaves description/color/timezone unchecked, although PRs #101 and #106 have merged. No issue text was changed for this status refresh.

### M7 — Non-widget fallback

PR #105 merged `!calendar help` and guidance directing capable clients to the widget. Issue #8 remains open; its body still shows help as unchecked. Upcoming/event queries and data-changing commands remain unfinished and depend on the M6 room-calendar binding and authorization path.

### M8 — Docker build and deployment groundwork

PR #102 merged Docker build/runtime documentation and a non-publishing CI image-build smoke. The smoke validates image builds, not deployment. The docs describe generic operator-run etke/MDAD compatibility only; no etke-managed host deployment has been verified, and the repository has no etke-native service definition or rollout integration. Helm/Kubernetes packaging remains optional later work.

## Active blockers

### M2 — User-scoped OpenID delegation

- #48 remains open for an ADR009-compatible OpenID mode in `radicale-auth-matrix`, preserving password authentication.
- #45 remains open for the final gateway/OpenID/non-member real-container contract and depends on #48.

These are the user's delegated CalDAV identity path. They do not establish credentials for the application principal.

### M6 — Room-owned application principal

ADR010 / PR #104 selects the room-owned application-principal model, but room-principal access is not ready to use. Define and test a non-password server-to-Radicale authentication path for the application principal. Then implement explicit room-to-calendar binding and per-operation membership, power, and policy checks. Matrix event sender data is authorization/audit context, not OpenID or CalDAV identity proof. Issue #7 remains open. Per-user bot calendars are deferred until a trusted actor-token path is independently defined and tested.

### M7 — Data commands

Issue #8 remains open after the help-only PR #105. `upcoming`, `event`, create, and delete/cancel commands depend on the M6 room-owned calendar binding and authorization contracts; do not implement them by treating a room sender as CalDAV identity.

### M8 — Deployment verification

After the authentication and runtime configuration are defined, verify the Docker-compatible services on the operator's etke-managed host. Build-smoke success and deployment documentation are not deployment evidence.

## Highest-priority next steps

1. Establish a writable source/release path and implement/test #48 outside this Apache-licensed application repository.
2. Complete #45 against the tested user-delegation mode.
3. Separately define/test application-principal Radicale authentication, then implement the ADR010 room binding and membership/power checks for M6.
4. Build M7 data commands on those M6 authorization contracts; help is already available.
5. Continue M4 with calendar color and compatibility/diagnostic items; keep timezone editing deferred.
6. Verify an operator-run deployment on the etke-managed host before claiming deployment compatibility.

## Working rules

- Prefer short-lived branches directly from current `main`; avoid stacked PR chains unless a dependency requires them.
- Keep vertical slices small and tested; do not build a generic WebDAV administration framework.
- Keep CalDAV credentials server-side and do not expose them in the widget or logs.
- Treat the Matrix sender as authorization context and audit data, never as proof of OpenID or CalDAV identity.

## Baseline and tracking

- NeoDateFix upstream: `nordeck/matrix-meetings@2d3011f665af04c3cd376c388f7ae3bcb06bba25`
- milestone trackers: #1 (M0), #2 (M1), #3 (M2), #4–#9 (M3–M8)
- M3 implementation slices: #61–#66 — complete
