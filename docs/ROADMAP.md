# Roadmap

[Documentation](./README.md) · [Current status](./STATUS.md) · [Milestones](./PLAN.md) · [Release evidence](./RELEASE.md)

_Reviewed 21 October 2026. The project remains pre-alpha._

Keep the existing CalDAV/Matrix calendar implementation and deliver a small, recoverable pilot. Then retire the remaining inherited meeting runtime in tested slices. The [roadmap issue #273](https://github.com/0cwa/matrix-calendar-widget/issues/273) is the issue-level dependency index; [#382](https://github.com/0cwa/matrix-calendar-widget/issues/382) tracks the newer subscription, reminder, and bot requirements.

## Priority and dependency order

| Workstream                             | State                                                                                                                                  | Next step                                                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calendar correctness foundations       | Complete: #274, #259, #282                                                                                                             | Preserve calendar-only startup, denied legacy APIs, and Matrix v12 creator-policy regressions.                                                           |
| Frozen application qualification       | Complete for source `99d4c9f`: #255 closed                                                                                             | Keep evidence attached to that source. Qualify any replacement candidate and its images independently.                                                   |
| Controlled operator pilot              | Active: [#251](https://github.com/0cwa/matrix-calendar-widget/issues/251)                                                              | Complete private readiness/materialization, live room/calendar canaries, off-server backup, isolated restore, rollback, and daily activation.            |
| Widget runtime cleanup                 | Complete: #275, #276, #258                                                                                                             | Retain calendar-only startup, tested legacy-link redirects, and the extracted editor boundaries.                                                         |
| Subscription/reminder/bot improvements | Scoped source work: [#382](https://github.com/0cwa/matrix-calendar-widget/issues/382)                                                  | Public feeds #385 and readable bot replies #383 are merged; selected-user/all-day reminders #384 are open; private external CalDAV editing remains open. |
| Legacy server retirement               | Gated: [#277](https://github.com/0cwa/matrix-calendar-widget/issues/277)                                                               | After the #251 pilot unless explicitly re-scoped; use the [source inventory](./legacy-server-inventory.md).                                              |
| Dependency and fixture consolidation   | Gated: [#278](https://github.com/0cwa/matrix-calendar-widget/issues/278)                                                               | Follow server retirement; remove only proven-unused consumers and add a narrow import-boundary guard.                                                    |
| Feedback and change-scope improvements | Follow-on: #256 residuals, #257                                                                                                        | Measure actual feedback and maintenance costs before adding more harness or codec structure.                                                             |
| Broader calendar functionality         | Deferred: [#5](https://github.com/0cwa/matrix-calendar-widget/issues/5), [#6](https://github.com/0cwa/matrix-calendar-widget/issues/6) | Collection timezone, general recurrence/occurrence edits, and broader interoperability need separate scope and acceptance.                               |

Source work and the operator pilot have separate acceptance requirements. A newly merged feature does not replace the frozen candidate or expand the pilot automatically. The [status page](./STATUS.md) distinguishes current `main` from open PRs; the [release ledger](./RELEASE.md) records the exact source and remaining gates.

## Bounded pilot

The target is one room and two accounts using the standard Element Web/Desktop side panel, one gateway replica, an independent project-owned Radicale store, and separate app-owned PostgreSQL state. Required browser acceptance uses `bot-account`; both principal modes retain mandatory backend, identity, authorization, and CalDAV contracts. Full appservice browser certification remains deferred even when a particular source passes it.

Mobile clients, existing managed Radicale store reuse, arbitrary recurrence, and additional layouts are not prerequisites for this pilot. Follow [beta scope](./beta-scope.md) for the exact limits. Scoped pilot authority and target facts remain in their operator record; wider rollout is a separate decision.

## Architecture to preserve

- **CalDAV remains canonical.** Preserve unknown iCalendar data, mixed resources, recurrence/timezone semantics, ETags, and conflict handling.
- **Matrix supplies identity and room policy.** Membership, power, binding, and management decisions stay on the server. The widget is the primary UI; commands are the fallback.
- **Application state stays separate.** Reminder state and optional dynamic bindings live in their own PostgreSQL stores. Public shares live with Radicale and require signing-key continuity during recovery.
- **The calendar domain owns its interfaces.** Keep `CalendarRepository` and domain types independent of FullCalendar, Matrix event shapes, and CalDAV wire types.
- **Retire inherited code through proven boundaries.** Ordinary widget startup already avoids the meeting Redux/invitation path. Remaining server removal follows the pilot gate and keeps required Matrix infrastructure.
- **Keep provenance.** Preserve licenses, NOTICE, upstream history, and historical decisions.

Changes to persistence, authentication, public APIs, permissions, calendar semantics, or deployment topology require an [ADR](./adrs/README.md), as described in [contributing](../CONTRIBUTING.md).

## Validate at the right level

1. **During development:** use focused workspace tests, types, lint, and deterministic fixtures for fast feedback.
2. **Before merging:** retain the five protected checks and affected service/integration contracts. Review the actual head and current base.
3. **For a release candidate:** bind complete approved client acceptance, images, recovery, and operator-rehearsal evidence to one frozen source. Hosted fixture success does not certify the target host.

See the [development guide](./DEVELOPMENT.md) for commands and the [release ledger](./RELEASE.md) for recorded results. Keep major dependency migrations outside a frozen candidate unless a concrete blocker justifies one. Redux-family upgrades need a retained-usage decision in #278; do not separately rebuild state that is scheduled for retirement.

## Measure maintenance improvements

The [cleanup baseline](./cleanup-baseline.md) records source-bound measurements. #256 is closed after bounded improvements, but complete baseline/full-feedback measurements remain follow-on work. PR #318 measures one Web journey; #320 covers sparse imports. Neither proves an overall feedback improvement.

Measure time to the first actionable failure, required-check and full-certification duration, setup-only failures, and the number of modules a representative change touches. Keep security, cleanup, preservation, accessibility, and timing gates intact. Further #257 extraction should solve a demonstrated maintenance problem. Large rewrites, service splits, and broad dependency changes are outside the current sequence.
