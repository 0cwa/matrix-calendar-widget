# M5 duration PERIOD widget evidence

## Candidate

- Branch: `codex/m5-duration-period-widget-20261003`
- Base: `f24a4979a052b2a293144b3192eeee0cc2e17fa6` (fetched `origin/main`, including merged PR #176)
- Feature code commit: `1d3b635685e9d31d4bb1043da23ac7cb06d16b2a`
- ADR status sync commit: `316c388e0e85eb210de1d49ab92b7b1c91693744`
- Candidate head: `316c388e0e85eb210de1d49ab92b7b1c91693744`
- Draft PR: [#177](https://github.com/0cwa/matrix-calendar-widget/pull/177), open and verified against the exact base/head above.
- Changed paths: `docs/PLAN.md`; `docs/adrs/adr023-floating-recurrence-semantics.md`; EN/DE widget translations; `calendarEventForm.ts` and tests/barrel; `CalendarEventEditorDialog.tsx` and tests.
- No server/domain or iCalendar codec files changed.

## Implemented behavior

- Timed recurring event forms can add a duration PERIOD starting at the existing additional-date/time draft.
- Duration inputs accept positive safe-integer weeks alone, or days and time units; zero-only, malformed, fractional, unsafe, and mixed week plus other units are rejected.
- The added PERIOD keeps the existing adapter's floating, UTC, or TZID start form. Point RDATE entry remains available, and all-day events keep point DATE entry without PERIOD controls.
- The dialog names the duration group, labels each unit, explains that the selected date/time is the period start, and shows guidance or an error while Add period is disabled.
- Existing PERIOD duration values remain listed and removable; their start and duration are unchanged by this slice.
- PLAN marks duration-form creation complete, keeps existing PERIOD timing edits open, and records PR #167's all-day DATE projection test around the 2026-10-25 Stockholm DST transition.
- ADR023 reflects widget creation support while leaving edits to existing PERIOD timing pending.

## Local evidence

The focused test and type/lint checks ran on code commit `1d3b635685e9d31d4bb1043da23ac7cb06d16b2a`. The only later source-history change is the three-line ADR023 status sync in `316c388`; widget source and tests are unchanged from the tested code commit. ADR023 was formatted with the locked formatter.

- Prettier `3.8.1` with `prettier-plugin-organize-imports` `4.1.0`: changed-file checks passed.
- Widget lint passed.
- Widget TypeScript check passed.
- EN/DE translation extraction check (`translate --ci --dry-run`) passed with no generated changes.
- Focused suites passed: `calendarEventForm.test.ts` and `CalendarEventEditorDialog.test.tsx`, 49 tests total.
- `git diff --check` passed.
- Impeccable detector on `CalendarEventEditorDialog.tsx` returned `[]`.

## Hosted status

PR #177 is a draft. The required checks `Quality`, `Widget`, `Server and bot`, `Container image build smoke`, and `Analyze JavaScript/TypeScript` were all in progress at verification; CodeRabbit reported success. Independent exact-head review remains pending.
