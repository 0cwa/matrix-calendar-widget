# Project status

_Last updated: 2026-09-22_

## Current phase

**M0 — Fork hygiene and safe development baseline**

The pinned NeoDateFix codebase is imported and the fork architecture/agent workflow has been established. Functional CalDAV migration has not started yet.

## Baseline

- NeoDateFix upstream: `nordeck/matrix-meetings@2d3011f665af04c3cd376c388f7ae3bcb06bba25`
- local upstream import: `387a3292d1a1ffce4d109762608d421f79ba1392`
- scaffold PR: #10

## Tracking

- #1 M0 fork hygiene
- #2 M1 calendar domain/repository seam
- #3 M2 Matrix OpenID gateway + Radicale discovery
- #4 M3 VEVENT CRUD
- #5 M4 collection management
- #6 M5 recurrence/iCalendar completeness
- #7 M6 Matrix permissions/reminders
- #8 M7 non-widget command fallback
- #9 M8 hardening/beta

## Next engineering move

After the scaffold PR is green and merged, work #1 first:

1. remove/rename inherited publishing identifiers,
2. establish ICS fixtures,
3. add a reproducible Synapse + Radicale development stack,
4. then begin #2 with the calendar-domain/repository seam.

Do not start by rewriting the UI. Reuse the inherited calendar interface and replace its data source incrementally.
