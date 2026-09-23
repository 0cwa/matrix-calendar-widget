# Project status

_Last updated: 2026-09-22_

## Current phase

**M1 — Calendar domain seam**

M0 engineering is merged. The fork now has Matrix Calendar-owned package/runtime identity, fork-owned CI, iCalendar regression fixtures, and a pinned Synapse + Matrix-authenticated Radicale development stack.

The remaining repository-admin action is #29 (enable `main` branch protection); it does not block M1 engineering.

M1 is being delivered as small stacked slices:

- #25 / PR #30 — product calendar domain types,
- #26 / PR #31 — `CalendarRepository` + in-memory repository,
- #27 — repository-backed widget read paths,
- #28 — repository-backed event mutations.

## Baseline

- NeoDateFix upstream: `nordeck/matrix-meetings@2d3011f665af04c3cd376c388f7ae3bcb06bba25`
- local upstream import: `387a3292d1a1ffce4d109762608d421f79ba1392`
- scaffold PR: #10
- M0 fork-hygiene PR: #24

## Tracking

- #1 M0 fork hygiene
- #29 main branch protection admin task
- #2 M1 calendar domain/repository seam
- #3 M2 Matrix OpenID gateway + Radicale discovery
- #4 M3 VEVENT CRUD
- #5 M4 collection management
- #6 M5 recurrence/iCalendar completeness
- #7 M6 Matrix permissions/reminders
- #8 M7 non-widget command fallback
- #9 M8 hardening/beta

## Engineering direction

Do not start by rewriting the inherited UI. Reuse its calendar, recurrence, accessibility, and responsive behavior while replacing the persistence/data model behind explicit domain and repository seams.
