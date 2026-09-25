# Project status

_Last updated: 2026-09-25_

This file is the short-lived execution snapshot. `docs/PLAN.md` is the durable milestone plan; GitHub issues contain acceptance criteria.

## Current phase

**M3 is complete. Close the external M2 auth blocker while advancing only small, independently useful M4 slices in parallel.**

The widget now has a real gateway-backed `CalendarRepository`, preservation-first VEVENT CRUD, visible conflict recovery, and a real two-client Radicale interoperability contract. The remaining M2 blocker is external: the pinned `etkecc/radicale-auth-matrix` plugin still only accepts Matrix passwords, while ADR009 requires short-lived Matrix OpenID delegation from the gateway.

## Landed

### M1 — Calendar domain seam

Complete on `main`:

- calendar/event domain model and repository seam,
- in-memory repository,
- repository-backed calendar/list/editor UI,
- create/edit/delete mutation hooks and invalidation.

### M2 — Gateway identity and Radicale discovery

Merged in-repo:

- authenticated calendar gateway context,
- Matrix room membership/power-level authorization,
- request-scoped validated Matrix OpenID credentials,
- CalDAV principal/home/calendar discovery,
- ADR009 delegated credential contract,
- OpenID→CalDAV credential provider,
- configured authenticated Radicale discovery endpoint,
- real password-auth Radicale discovery contract.

Still external/blocking:

- #48 — add ADR009-compatible OpenID mode to `radicale-auth-matrix`,
- #45 — final real gateway/OpenID/non-member contract after #48.

### M4 — Calendar management

Landed on `main`:

- VEVENT-only calendar creation through repository → gateway → CalDAV `MKCALENDAR` (#92 / PR #94),
- lightweight local calendar visibility controls with friendly names/colors (#95 / PR #96),
- writable-calendar rename via `DAV:displayname` only (#98 / PR #99),
- small create/rename dialogs that keep request errors visible.

Active:

- safe VEVENT-only calendar deletion (#100 / PR #101). The implementation already fails closed for mixed, component-unknown, and read-only collections and rejects DELETE `207 Multi-Status`; the branch currently needs synchronization with `main` after the rename merge.

### M3 — VEVENT CRUD

Complete on `main`:

- preservation-first `ical.js` codec (#61 / PR #70),
- visible-range and individual resource transport with ETags,
- conditional create/update/delete and structured conflicts,
- authenticated room-authorized gateway VEVENT CRUD,
- gateway-backed widget `CalendarRepository`,
- visible reload/retry conflict UX,
- real Radicale two-client round-trip and stale-ETag contract (#66 / PR #90),
- consolidated M3.2–M3.5 delivery through PR #89.

## Active

- #48 — external `radicale-auth-matrix` OpenID delegation. No writable `0cwa/radicale-auth-matrix` fork exists and the available GitHub connector cannot create/fork repositories.
- #45 — final delegated gateway/OpenID real-container contract, blocked on #48.
- #100 / PR #101 — M4 safe calendar deletion; implementation is present, but the branch currently diverges from `main` after #99 merged and must be synced before merge.
- #29 — enable main-branch protection once repository-rules administration is available.

## Highest-priority next steps

1. Implement #48 in a writable upstream/forked `radicale-auth-matrix` repository; do not copy GPL/LGPL-family plugin code into this Apache-licensed repository.
2. Land #45's final gateway/OpenID/non-member real-container contract and close M2.
3. In parallel while #48 is blocked, synchronize and finish #100 / PR #101: safe VEVENT-only calendar deletion through the existing repository/gateway seams.
4. After delete lands, reassess the next smallest M4 slice (description, color, timezone, compatibility notice, or diagnostics) rather than pre-building generic WebDAV administration.

## Working rules

- Prefer short-lived branches directly from current `main`; avoid stacked PR chains unless the dependency truly cannot merge first.
- Do not wait on long CI when independent work exists.
- Keep YAGNI pressure on abstractions: reuse the existing repository, auth, credential, codec, and transport seams.
- Do not add caches, sync engines, generic DAV clients, or recurrence/calendar-management frameworks before a concrete slice needs them.
- Treat protocol details as server-internal; widget users manage Calendars, not DAV collections.

## Baseline and tracking

- NeoDateFix upstream: `nordeck/matrix-meetings@2d3011f665af04c3cd376c388f7ae3bcb06bba25`
- milestone trackers: #1 (M0), #2 (M1), #3 (M2), #4–#9 (M3–M8)
- M3 implementation slices: #61–#66 — complete
