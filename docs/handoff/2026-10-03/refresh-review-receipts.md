# Refreshed PR review receipts

Read-only reviews recorded for the M5/M6 integration sequence on 2026-10-03.
No source edits or local tests were made during either review.

## PR #171 — reminder trigger helper

- Reviewed base: `1f10e9abc959a5b912400b5d01a45ea38407c829`.
- Reviewed refreshed head: `e67744560bd9233d62956625ca4fe022abea7419`.
- Previous reviewed head: `e61fa356ea499e6394a592e0decccd5d5be2b877`.
- Result: PASS; no findings.
- `git diff --name-status base..head` showed only
  `matrix-calendar-server/src/reminder/ReminderTrigger.ts`,
  `matrix-calendar-server/src/reminder/ReminderTrigger.test.ts`, and
  `matrix-calendar-server/src/reminder/index.ts`.
- The three changed-file patches matched byte for byte between `base..e61fa35`
  and `base..e677445`. Their SHA-256 digests were, in that order:
  `f96a12d5ce536c23982c3aed000b165cc5c4965b44edd499bd22dd83c4c4cb77`,
  `4f8136e5a3175c8fdf004b489b37a0d7e6a8ae2b4908da32c2f81292c0951a7f`, and
  `dc7ec9dc48bc7f68efcbc7fbe72cd91c403093513fc49b03a1c6783dfe09a12b`.
- Static source review confirmed a pure reminder-time helper over an already
  resolved occurrence; it fails closed on DATE/floating anchors and unsupported
  trigger/repeat shapes. The diff adds no scheduler, authorization, storage, or
  message-sending wiring. Hosted CI owns test proof; local tests were not run.

## PR #175 — duration-form PERIOD RDATE backend support

- Reviewed base: `948bf00286363ea91bc97c8d5655987b6e15dff9`.
- Reviewed refreshed head: `9b7848c3af878a4d957be57cb557848ee1ca86ef`.
- Previous reviewed base/head: `8bf300f45798a2e88a7596f2a5959150f6d0da8a` /
  `c376b056184ae368d145ee7666c7644c166a8dd5`.
- Result: PASS; no findings.
- The old and refreshed diffs have the same seven paths and each per-file
  `git diff --binary` matched byte for byte. The paths are `docs/PLAN.md`,
  `docs/adrs/adr023-floating-recurrence-semantics.md`, the CalDAV event codec
  and its tests, the calendar model, and the in-memory repository and its tests.
- Static source review confirmed the typed write accepts positive RFC duration
  PERIOD values; codec validation rejects zero, negative, fractional, malformed,
  unknown or missing units, unsafe integers, and weeks combined with other
  units. It preserves floating and UTC starts, writes named-TZID starts only
  when the exact source VTIMEZONE exists, makes exact duplicate additions
  idempotent, and preserves sibling recurrence/resource data.
- The change remains in the backend/domain/docs scope. Its plan leaves widget
  duration entry and editing an existing PERIOD's timing pending. Hosted CI was
  running during review; local tests were not run.

## PR #176 — per-command timezone parser

- Reviewed base: `fd55c1ce16727fcccf10486576ca5caf2241b25b`.
- Reviewed refreshed head: `800bd5e331be3afd57dbda65bc8176c54334144b`.
- Previous reviewed base/head: `8bf300f45798a2e88a7596f2a5959150f6d0da8a` /
  `dbc5f2d153a85bb55f91b5fc3ad0442f2a22b532`.
- Result: PASS; no findings.
- The old and refreshed diffs contain exactly
  `matrix-calendar-server/src/service/CommandContext.test.ts` and
  `matrix-calendar-server/src/service/CommandContext.ts`; both per-file
  `git diff --binary` patches matched byte for byte. Their SHA-256 digests are
  `ed7ec2494f345e993df460d4d5e9cd62fc5100ef80649d3677b1d25672e42f71` and
  `be70d29d0039c7ac0c9ae531b80d5dc4757e20e55816e0c5c8be033a36465755`.
- Static review confirmed a UTC default, exact removal of one `--tz <value>`
  pair, preservation of other arguments, and rejection of duplicates, equals
  syntax, missing/option-like values, signed offsets, and invalid zones. The
  parser has no command consumer or calendar query semantics yet. Hosted CI was
  running during review; automated project tests were not rerun.
