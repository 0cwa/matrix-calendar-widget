# Upstream provenance and sync policy

## Origin

Matrix Calendar Widget is a derivative of Nordeck's NeoDateFix / `matrix-meetings` project.

Pinned baseline:

- upstream repository: https://github.com/nordeck/matrix-meetings
- upstream commit: `2d3011f665af04c3cd376c388f7ae3bcb06bba25`
- upstream commit date: 2026-09-21
- local baseline import commit: `387a3292d1a1ffce4d109762608d421f79ba1392`
- license: Apache-2.0

The import intentionally excluded upstream GitHub Actions workflows. Repository automation is fork-specific.

## Why hard-fork

NeoDateFix already provides substantial production-oriented work that is directly useful:

- Matrix Widget API integration,
- Element-compatible MUI patterns,
- FullCalendar month/week/list rendering,
- responsive calendar UI,
- date/time controls,
- recurrence editor,
- Matrix member selection,
- bot/server structure,
- localization,
- accessibility tests,
- unit/E2E infrastructure,
- container/deployment examples.

Reusing this code is faster and lower risk than recreating the widget shell before proving CalDAV integration.

## What is not inherited as architecture

NeoDateFix's core meeting model stores meeting metadata in Matrix rooms and creates/manages meeting rooms. The fork instead makes CalDAV/Radicale canonical. Upstream data-model and API ADRs remain useful historical material but are not automatically current decisions.

## Sync policy

This is a hard fork, not a long-lived mirror. Do **not** routinely merge upstream `main`.

When an upstream fix is valuable:

1. identify the exact upstream commit(s),
2. assess whether the touched code still exists and has the same responsibility,
3. cherry-pick or manually port the narrow change,
4. retain attribution,
5. record the upstream commit in the PR,
6. run the fork's full CI and calendar regression suite.

Avoid bulk merges after the calendar-domain migration begins.

## License/NOTICE

Retain Apache-2.0 license text and applicable copyright, patent, trademark, and attribution notices from inherited source. Keep upstream NOTICE files where they still apply. Modified inherited files should follow the license's modification-notice requirements.
