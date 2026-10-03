# Technical debt audit — 2026-10-03 (final snapshot)

## Snapshot

- Exact remote `main`: `8bf300f45798a2e88a7596f2a5959150f6d0da8a`, merged from PR #166 at 2026-10-03 12:07:33 UTC.
- Open issues: #5–#9. Closed: #29 branch protection, #45 personal OpenID real contract, #48 owned OpenID-only Radicale auth, #100 safe deletion.
- Open PR #164 remains draft and based on `d1cd5f0`; its old merge ref failed server Jest and the Personal OpenID module-load probe before room-contract execution. It has no current-main rerun.
- PR #167 (`55abf37`), #171 (`e61fa35`), #175 (`c376b05`) now target current main. Independent read-only reviews PASS for #167/#171/#175/#176. At snapshot time their Widget checks were still running; #175's Server and bot was also running. PR #176 (`dbc5f2d`) had current-main checks running except CodeQL, which passed.
- Main protection is configured: PR + conversation resolution, five checks, force-push/deletion disabled.

## Confirmed findings

1. **M6 room access remains unvalidated on a current PR head.** The last observed #164 check run (base `d1cd5f0`) failed at “Test server” and “Probe Personal OpenID contract module load”; the room contract never started. This is an old-ref delivery blocker, not evidence current main fails. Smallest next step: sync #164 to `8bf300f`, inspect sanitized first failures, then execute room access and cross-room assertions.
2. **No confirmed architectural refactor trigger.** Gateway operations share auth/CalDAV boundaries; codec read/create/patch use one serialization boundary; recurrence projection is bounded and covered by DST tests. No repeat failure or broad review friction supports extraction.
3. **A stale work-unit dependency was observed and resolved.** The M5 EXDATE UI record said to wait for PR #164 before a PLAN update and PR #166 merge. Current `docs/PLAN.md` already marks occurrence skip/restore complete and general EXDATE editing open; #166 merged. PR #175 preserves that. The orchestration owner resolved the stale PR #164 dependency; there is no remaining documentation gap.

## Independent review results

- **#167 PASS:** current head changes one projection test only (+68 lines); stable patch ID `701ae71f5508e7c11fff9ab82ba91439399a0582` matches old head 434a9ae. Expected all-day intervals correctly overlap two Stockholm half-open viewer windows spanning the DST boundary.
- **#171 PASS:** current head changes three reminder trigger paths (584 additions); stable patch ID `0be12c5bd7c78dcb505fd0ce721f2ec3a189fac1` matches old head dc658a8. Reviewed strict source lexeme validation, nominal day/week vs exact clock-unit arithmetic, repeat bounds, and fail-closed unsupported forms.
- **#175 PASS:** current head changes exactly seven expected files; stable patch ID `7e1c140e2c534ddc102bd3a07791ef89` matches old head 5abaf5b. Duration PERIOD writes are bounded to domain/codec/in-memory support with preservation tests; PLAN/ADR leave widget entry and timing edits open and preserve existing EXDATE completion/open boundaries.
- **#176 PASS:** current head changes exactly `CommandContext.ts` and its focused test (+142 lines); stable patch ID `679c30fe42aed4b2ea62c8c0a7037caf1ebba4f4` matches old head 8545e1c. Parser has deterministic UTC default, removes one explicit `--tz value`, rejects duplicates/equals/missing/invalid/offset forms, and preserves other args.
- Reviews were source-only; no local tests were run.

## Deferred gates and dependencies

- Appservice `owner_only` Radicale credentials can access the whole service home. Cross-room safety must be proven before room-target data is enabled.
- Actual etke image override, `/data` preservation, and operator deployment remain unverified M8 gates.
- Keep #167/#171/#175/#176 current-main CI completion tied to their exact heads; do not infer merge readiness from earlier base checks.

## Ordered remaining project slices

1. Finish current-base checks for #167/#171/#175/#176 and tie disposition to each exact head.
2. **Next M5 after #175 merges: widget entry for duration-form PERIOD RDATEs.** The current form has a single RDATE date/time draft and emits only point add/remove operations in `matrix-calendar-widget/src/calendar/calendarEventForm.ts:62-71,635-670`; the dialog adds that point and can remove existing PERIOD values in `matrix-calendar-widget/src/components/calendar/CalendarEventEditorDialog.tsx:220-256,835-940`. PR #175 supplies the model/codec/in-memory duration write support. Keep this as widget-only ownership: `calendarEventForm.ts` + its tests, `CalendarEventEditorDialog.tsx` + its tests, locales, and `docs/PLAN.md`. Build a typed duration PERIOD from the draft start and a positive RFC duration, preserving the event's DATE-TIME form/TZID; reject invalid values and all-day starts. Test form conversion, dialog save/cancel, and persistence via the repository. Start from then-current main after #175 merges; it does not depend on #164 and avoids #175's server/domain files.
3. Then add editing of existing PERIOD start/end/duration as a separate codec/API/editor slice.
4. Extend RRULE patterns in bounded additions, then RECURRENCE-ID override editing and explicit “this event / this and following / series” scopes. Add regression tests for each recurrence and timezone behavior.
5. Continue M5 round-trip work: remaining DST/named-timezone matrix, SEQUENCE/timestamp semantics, organizer/attendee, safe attachment/conference properties, and broader alarms. Keep each change scoped and add round-trip fixtures before codec changes.
6. In parallel, sync/revalidate #164; finish appservice proof issuance, authorize before CalDAV, then prove real room access and cross-room isolation. Keep room operations/reminders disabled until those gates pass.
7. M7 data commands follow M6 room policy; help and timezone parser can proceed independently.
8. M8 repository-side accessibility, threat-model, abuse/privacy, compatibility, and performance work can proceed in parallel. The etke image override and `/data` preservation rehearsal is a live external readiness gate after runtime/auth details settle; it does not block repository-side M5/M7/M8 implementation.

Artifacts: `technical-debt-evidence.json`, `architecture-friction-case.json`, `technical-debt-audit.md`, and refreshed `tmp/tech-debt-report.html`.
