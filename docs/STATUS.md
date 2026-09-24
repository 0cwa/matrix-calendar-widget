# Project status

_Last updated: 2026-09-24_

This file is the short-lived execution snapshot. `docs/PLAN.md` is the durable milestone plan; GitHub issues contain acceptance criteria.

## Current phase

**Finish the last M2 integration blocker; do not expand scope until the real discovery path is closed.**

M1 is complete. The authenticated widget → gateway → CalDAV discovery path is implemented in-repo. The only architectural blocker left in M2 is external: the currently pinned `etkecc/radicale-auth-matrix` plugin only supports Matrix password login, while ADR009 requires short-lived Matrix OpenID delegation.

## Landed

### M1 — Calendar domain seam

Complete on `main`:

- calendar/event domain model,
- `CalendarRepository` + in-memory implementation,
- transport-agnostic authorization seam,
- repository-backed widget read paths,
- mutation hooks/invalidation,
- repository-backed create/edit/delete UI.

### M2 — Gateway identity and Radicale discovery

Merged on `main`:

- authenticated calendar gateway context (#42 / PR #46),
- Matrix room membership/power-level authorization (#43 / PR #47),
- request-scoped validated OpenID credential (#50 / PR #52),
- CalDAV principal/home/calendar discovery client (#49 / PR #53),
- ADR009 OpenID→Radicale delegation contract (#54),
- OpenID→CalDAV credential provider bridge (#55 / PR #57),
- configured authenticated Radicale calendar discovery endpoint (#56 / PR #58).

## Active

- #48 — external `radicale-auth-matrix` change required for gateway OpenID delegation. The stock plugin still hardcodes `m.login.password`. ADR009 defines the compatible extension. No `0cwa/radicale-auth-matrix` fork currently exists, and this repository connector cannot create one.
- #45 — final delegated gateway/OpenID/non-member real-container contract. The password-auth Radicale discovery contract is already merged in PR #60; the remaining part depends on #48.

## Highest-priority next steps

1. Implement #48 in an upstream/forked `radicale-auth-matrix` repository; do not copy GPL/LGPL-family plugin code into this Apache-licensed repository.
2. Add the final gateway/OpenID/non-member real-container contract under #45 and close M2.
3. Only then make M3 implementation the default focus. M3 is decomposed as #61–#66; #61 (preservation-first iCalendar codec) is the best parallel task only if #48 is blocked on external repository access.

## Friction / working rules

- Avoid long-lived stacked PR chains. Squash-merging prerequisites repeatedly forced branch-tree reconstruction and obscured small diffs. Prefer short-lived branches directly from current `main`; if a dependency is tiny, merge it promptly before opening the next slice.
- Stop creating temporary formatter workflows for single files. They created extra commits, action runs, and rebase churn. Run the repo formatter before pushing, or make one direct formatting commit on the feature branch.
- Do not poll long widget/CodeQL jobs when independent work exists. Use fast gates to continue development; return to merge once the long jobs settle.
- Keep YAGNI pressure on abstractions. The repository/auth/credential seams are sufficient; do not add another cache/client/service layer until a concrete vertical slice needs it.
- M3 preservation/ETag work matters, but starting broad recurrence/calendar-management abstractions before M2 closes would be premature.

## Non-blocking administration

- #29 remains open: `main` branch protection is still not enabled.

## Baseline and tracking

- NeoDateFix upstream: `nordeck/matrix-meetings@2d3011f665af04c3cd376c388f7ae3bcb06bba25`
- milestone trackers: #1 (M0), #2 (M1), #3 (M2), #4–#9 (M3–M8)
- M3 implementation slices: #61–#66
