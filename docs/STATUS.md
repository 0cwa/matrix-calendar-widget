# Project status

_Last updated: 2026-09-23_

This file is the short-lived execution snapshot. `docs/PLAN.md` is the durable milestone plan; GitHub issues contain acceptance criteria.

## Current phase

**Finish M1 while advancing M2 in parallel.**

The implementation baseline on `main` before this status-only documentation update is `f88f9f4` (`test: stabilize calendar day picker interaction (#51)`).

### M1 — Calendar domain seam

Merged on `main`:

- #25 / PR #30 — product calendar domain types,
- #26 / PR #31 — `CalendarRepository` + in-memory repository,
- #39 / PR #41 — transport-agnostic calendar authorization seam,
- #27 / PRs #34/#35 — repository-backed query/read/presentation path,
- #36 / PR #38 — repository mutation hooks and query invalidation.

Remaining:

- #37 / PR #40 — repository-backed event create/edit/delete UI. The PR is mergeable and its CI + CodeQL are green. Landing it completes #28 and the remaining M1 implementation slice.

### M2 — Matrix OpenID gateway and Radicale discovery

Merged on `main`:

- #42 / PR #46 — authenticated calendar gateway context,
- #43 / PR #47 — Matrix room membership/power-level authorization policy,
- #54 — ADR009, defining the OpenID-to-Radicale delegation contract without Matrix passwords.

Active PRs:

- #50 / PR #52 — request-scoped validated OpenID credential context. The PR is mergeable but needs refreshing onto current `main`; its latest workflow runs are `action_required` and contain no jobs.
- #49 / PR #53 — CalDAV discovery client behind `CalDavCredentialProvider`. The PR is mergeable but CI is red: TypeScript rejects one-generic-argument Jest mocks in `CalDavDiscoveryClient.test.ts` at lines 204 and 233 (TS2743). Widget and CodeQL checks pass; the same compile error fails Quality/type-check and Server/tests. Refresh onto `main`, fix those test typings, and rerun CI.

Next dependency order:

1. Land PR #40.
2. Refresh/fix and land PRs #52 and #53.
3. Implement #55 — bridge validated Matrix OpenID credentials into `CalDavCredentialProvider` using ADR009.
4. Implement #56 — configured authenticated Radicale calendar discovery endpoint.
5. Complete #48 — OpenID-capable `radicale-auth-matrix` mode while retaining ordinary Matrix-password CalDAV compatibility. This can proceed in parallel with steps 1–4.
6. Complete #45 — real Synapse + Radicale discovery contract tests once the gateway and plugin path are wired.

## Non-blocking repository administration

- #29 remains open: `main` branch protection is not enabled. The documented policy lives in `docs/BRANCH_PROTECTION.md`.

## Baseline and tracking

- NeoDateFix upstream: `nordeck/matrix-meetings@2d3011f665af04c3cd376c388f7ae3bcb06bba25`
- local upstream import: `387a3292d1a1ffce4d109762608d421f79ba1392`
- scaffold PR: #10
- M0 fork-hygiene PR: #24
- milestone trackers: #1 (M0), #2 (M1), #3 (M2), #4–#9 (M3–M8)

## Engineering direction

Keep working in small vertical slices. Reuse inherited calendar, recurrence, responsive, and accessibility behavior while replacing persistence behind calendar-domain/repository seams. Do not introduce Matrix passwords into the gateway, and keep DAV/XML wire types server-internal.
