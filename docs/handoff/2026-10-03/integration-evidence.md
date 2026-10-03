# Ready PR integration evidence

Repository: `0cwa/matrix-calendar-widget`. All merges below used the normal GitHub squash path, without admin/bypass options. Branch updates used `gh pr update-branch` and preserved the original PR patch byte-for-byte. Evidence was captured from GitHub for the listed exact heads.

## PR #166 — existing EXDATE editor support

- Reviewed head: `884c4c2e9030ec19c911072b24f820b278a5459c`; base: `d1cd5f026198b55c1fdf0eb34fa96ee480a5d3b0`.
- Scope: six expected form/editor/test/locale files; unchanged from the recorded candidate.
- Checks: Quality, CodeQL, Widget, Server and bot, Container image build smoke, CodeRabbit — all SUCCESS.
- Merge: `2026-10-03T12:07:33Z`; squash commit `8bf300f45798a2e88a7596f2a5959150f6d0da8a`.

## PR #167 — all-day recurrence projection test

- Forwarded from base `d1cd5f026198b55c1fdf0eb34fa96ee480a5d3b0` onto `8bf300f45798a2e88a7596f2a5959150f6d0da8a` with GitHub's normal branch update.
- Updated head: `55abf37135644a1f2295becf925cbe69cd5ecd53`; diff byte-compared equal to the pre-update patch.
- Scope: only `packages/calendar/src/utils/calendarEventOccurrenceProjection.test.ts` (68 additions).
- Independent review: PASS on the exact updated head. Checks: Quality, Analyze JavaScript/TypeScript, Widget, Server and bot, Container image build smoke, CodeQL, CodeRabbit — all SUCCESS.
- Merge: `2026-10-03T12:16:33Z`; squash commit `1f10e9abc959a5b912400b5d01a45ea38407c829`.

## PR #171 — reminder trigger time helper

- Forwarded from base `d1cd5f026198b55c1fdf0eb34fa96ee480a5d3b0` onto `8bf300f45798a2e88a7596f2a5959150f6d0da8a` with GitHub's normal branch update.
- First updated head: `e61fa356ea499e6394a592e0decccd5d5be2b877`; diff byte-compared equal to the pre-update patch.
- Scope: `matrix-calendar-server/src/reminder/ReminderTrigger.test.ts`, `ReminderTrigger.ts`, and `reminder/index.ts` (the expected three trigger helper paths).
- Independent review: PASS on first updated head e61fa35. Checks on e61fa35: Quality, Analyze JavaScript/TypeScript, Widget, Server and bot, Container image build smoke, CodeQL, CodeRabbit — all SUCCESS.
- Normal merge attempt was rejected by branch protection because e61fa35 was behind the then-current base `1f10e9abc959a5b912400b5d01a45ea38407c829`; no bypass option was used.
- Forwarded again onto current main `1f10e9abc959a5b912400b5d01a45ea38407c829`. New head: `e67744560bd9233d62956625ca4fe022abea7419`; mergeability is MERGEABLE and the full diff byte-compares equal to e61fa35. The three-path scope is unchanged.
- Fresh checks on e677445: Quality, Analyze JavaScript/TypeScript, Server and bot, Container image build smoke — SUCCESS; Widget — IN_PROGRESS; CodeRabbit — SUCCESS.
- Independent M5 lane review: PASS on exact head e677445 against base `1f10e9abc959a5b912400b5d01a45ea38407c829`; reviewer confirmed the three paths are byte-identical, the helper remains isolated, and source fit is correct. Hosted CI owns test proof; no local tests were rerun.
- Integration note: this pure trigger-time helper is independent of PR #164; scheduler wiring remains sequenced behind #164.
- Final checks on e677445: Quality, Analyze JavaScript/TypeScript, Widget, Server and bot, Container image build smoke, CodeQL, CodeRabbit — all SUCCESS.
- Merge: `2026-10-03T12:27:57Z`; squash commit `948bf00286363ea91bc97c8d5655987b6e15dff9`.

## PR #175 — duration-form PERIOD RDATE support

- Forwarded from base `d1cd5f026198b55c1fdf0eb34fa96ee480a5d3b0` onto `8bf300f45798a2e88a7596f2a5959150f6d0da8a` with GitHub's normal branch update.
- Updated head: `c376b056184ae368d145ee7666c7644c166a8dd5`; diff byte-compared equal to the pre-update patch.
- Scope: expected seven codec/model/repository and PLAN/ADR paths.
- Independent review: PASS on c376b05; reviewer confirmed PLAN scope. All checks on c376b05 completed SUCCESS, including Widget.
- After #171 merged, forwarded c376b05 onto current main `948bf00286363ea91bc97c8d5655987b6e15dff9`. New head: `9b7848c3af878a4d957be57cb557848ee1ca86ef`; diff byte-compares equal to c376b05 and all seven expected paths remain unchanged.
- Fresh checks on 9b7848c: Quality, Real Radicale contract, Analyze JavaScript/TypeScript, Widget, Server and bot, Container image build smoke, CodeQL, CodeRabbit — all SUCCESS.
- Independent M5 lane review: PASS on exact head 9b7848c against base `948bf00286363ea91bc97c8d5655987b6e15dff9`; reviewer verified byte-identical diffs for all seven expected paths and completed duration, serializer, and preservation review with no findings.
- Merge: `2026-10-03T12:36:17Z`; squash commit `fd55c1ce16727fcccf10486576ca5caf2241b25b`.

## PR #176 — per-command timezone context parser

- Forwarded from base `d1cd5f026198b55c1fdf0eb34fa96ee480a5d3b0` onto `8bf300f45798a2e88a7596f2a5959150f6d0da8a` with GitHub's normal branch update.
- First updated head: `dbc5f2d153a85bb55f91b5fc3ad0442f2a22b532`; diff byte-compared equal to the pre-update patch.
- Scope: `matrix-calendar-server/src/service/CommandContext.test.ts` and `CommandContext.ts` only.
- Independent review: PASS on first updated head dbc5f2d. All checks on dbc5f2d completed SUCCESS.
- After #175 merged, forwarded dbc5f2d onto current main `fd55c1ce16727fcccf10486576ca5caf2241b25b`. New head: `800bd5e331be3afd57dbda65bc8176c54334144b`; diff byte-compares equal to dbc5f2d and the expected two paths remain unchanged.
- Fresh checks on 800bd5e: Quality, Analyze JavaScript/TypeScript, Widget, Server and bot, Container image build smoke, CodeQL, CodeRabbit — all SUCCESS.
- Independent M5 lane review: PASS on exact head 800bd5e against base `fd55c1ce16727fcccf10486576ca5caf2241b25b`; reviewer confirmed both expected file patches are byte-identical to the previously reviewed candidate and verified source/parser boundaries.
- Merge: `2026-10-03T12:46:21Z`; squash commit `f24a4979a052b2a293144b3192eeee0cc2e17fa6`.

## Workspace state

No source checkout edits were made. The stale root `main` checkout and its pre-existing untracked files were left untouched; `tmp/tech-debt-report.html` was preserved.

## Current remote snapshot

- Remote `main`: `f24a4979a052b2a293144b3192eeee0cc2e17fa6` after #176 merged.
- #171 is merged at `948bf00286363ea91bc97c8d5655987b6e15dff9` after exact-head review and green checks.
- #175 is merged at `fd55c1ce16727fcccf10486576ca5caf2241b25b` after exact-head review and green checks.
- #176 is merged at `f24a4979a052b2a293144b3192eeee0cc2e17fa6` after exact-head review and green checks.
