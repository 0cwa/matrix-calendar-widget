# Project status

[Documentation](./README.md) · [Roadmap](./ROADMAP.md) · [Implementation plan](./PLAN.md) · [Release evidence](./RELEASE.md)

_Updated 21 October 2026 against `main` at [`224fa735`](https://github.com/0cwa/matrix-calendar-widget/commit/224fa73597356fd920d65483ad7741795c3f2766), after documentation PR #387 merged. Application evidence remains tied to its listed source SHAs; open PRs are identified separately below._

**Pre-alpha.** The calendar implementation is available for development. The controlled pilot targets Element Web/Desktop, one gateway replica, an independent project-owned Radicale store, and separate app-owned PostgreSQL state. A previously frozen source has application and image evidence; target configuration, live pilot use, backup/recovery, and wider rollout remain distinct gates in the [release ledger](./RELEASE.md).

## Implemented on main

| Area                         | Implemented scope                                                                                                                                                                    | Important limits                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and calendar access | Matrix OpenID, server-side authorization, personal CalDAV access, and room calendars with explicit bindings                                                                          | No Matrix-password login; room membership alone does not grant every write or management action                                         |
| Calendar UI                  | List/day/work-week/week/month views; event create, read, edit, and delete; conflict recovery                                                                                         | Real use needs a widget host and gateway; the view is not a complete calendar export                                                    |
| Calendar management          | Visibility, VEVENT-only creation, rename, safe deletion, description and color                                                                                                       | Collection timezone editing deferred; mixed collections and unsupported members preserved                                               |
| Recurrence and event details | Supported RRULE/RDATE/EXDATE forms, selected-occurrence timing/text, bounded following edits, safe conference/URI attachment operations, supported display alarms                    | Arbitrary RRULEs, general splitting, attendee/email authoring, binary uploads, and broader forms remain unsupported                     |
| Room setup                   | Optional moderator `!calendar setup`, durable dynamic bindings, verified collection and widget setup                                                                                 | Independently default-off; static bindings remain authoritative; no general rebind/delete workflow                                      |
| Matrix reminders             | Manager configuration, persistent delivery state, bounded scheduler, whole-room mentions for supported alarms                                                                        | Unencrypted rooms only; configuration and delivery are separate gates; current `main` does not include selected-member/all-day delivery |
| Public subscriptions         | Opt-in, per-calendar read-only ICS feeds with explicit consent and revocation, merged in [#385](https://github.com/0cwa/matrix-calendar-widget/pull/385)                             | Anyone with the link can read; VEVENT-only content; ingress/logging/signing-key recovery must be configured; not private CalDAV editing |
| Bot fallback                 | `!calendar` help/setup/upcoming/event/create/delete/cancel; title-first localized timing and opt-in listing IDs from [#383](https://github.com/0cwa/matrix-calendar-widget/pull/383) | Bounded fallback with server-enforced permissions; human pilot-room acceptance is separate                                              |
| Calendar-first startup       | Calendar root and legacy-link redirect, with widget meeting Redux/invitation startup removed                                                                                         | Legacy server handlers and some inherited shared code remain; removal is tracked in #277/#278                                           |

The [user guide](./user-guide.md) explains the supported workflows. The [data model](./data-model.md), [configuration reference](./configuration.md), and [ADRs](./adrs/README.md) define the implementation boundaries.

## In development and deferred

- [PR #384](https://github.com/0cwa/matrix-calendar-widget/pull/384) is open at this snapshot: selected joined-member reminder targets, explicit all-day delivery schedules, and combined alarm/reminder controls. These are not shipped features of the baseline above.
- [Issue #382](https://github.com/0cwa/matrix-calendar-widget/issues/382) tracks remaining subscription/reminder/bot work. Public feeds and readable bot replies have merged; private external CalDAV read/write credentials remain open.
- Private external CalDAV editing is in development on a dedicated source branch, not current `main`. The reviewed backend, isolated PostgreSQL and private Radicale contracts, integrated type/build/widget checks, and the combined map-plus-token public-feed Radicale contract pass locally at source `867ef236`. Same-database migration coexistence with reminder v4 and room bindings, actual desktop-app acceptance, and real Matrix-policy integration remain open. See the [branch validation record](./private-calendar-app-access-validation.md). Keep the capability default-off; this work does not authorize deployment.
- [Issue #386](https://github.com/0cwa/matrix-calendar-widget/issues/386) tracks appservice-mode packaged Desktop room navigation on the public-feed source. The normal-bot acceptance job passed on that source; the appservice failure is not silently reclassified as a pass.
- [Issue #5](https://github.com/0cwa/matrix-calendar-widget/issues/5) retains collection timezone work; [#6](https://github.com/0cwa/matrix-calendar-widget/issues/6) retains broader recurrence and cross-client interoperability.
- Mobile/other-client certification, full-width/pinned layouts, broader capacity claims, and formal screen-reader certification remain outside the bounded pilot. Calendar/Radicale testing for the developing Android widget host belongs in [#372](https://github.com/0cwa/matrix-calendar-widget/issues/372).

## Application evidence and deployment readiness

The accepted frozen application source remains `99d4c9f9f36aa0b0861a13499a7f7cd512c56920`, tree `97022a9d2351655d2aae0a50a44a14bd81daacc9`. Its required checks, both-mode service contracts, Element Web/Desktop acceptance, three-image archive, and hosted operator rehearsal are recorded in [RELEASE.md](./RELEASE.md). Later source changes do not inherit that release qualification.

The newer public-feed source `abff46bc30b2f2ade61261bdd58dc76f0183b7f7`, tree `cbcbe4bfcc7827b7728ce5c21f6a8d88d3cf9d55`, merged as `817854b` with the same tree. Its [CI](https://github.com/0cwa/matrix-calendar-widget/actions/runs/39604238241), [CodeQL](https://github.com/0cwa/matrix-calendar-widget/actions/runs/39604238498), [CalDAV contract](https://github.com/0cwa/matrix-calendar-widget/actions/runs/39604238281), and [operator PostgreSQL contract](https://github.com/0cwa/matrix-calendar-widget/actions/runs/39604238304) passed. [Element acceptance attempt 2](https://github.com/0cwa/matrix-calendar-widget/actions/runs/39604238326/attempts/2) passed the normal-bot job and failed the appservice job; #386 records the Desktop navigation failure. These results are tied to that source, not to a later documentation or product commit. They do not constitute a replacement frozen candidate, a public-feed client certification, or a target deployment.

The public operator record still reports pilot services stopped. Target readiness/materialization, configured-room canaries, actual off-server backup, isolated restore, disable/rollback, and daily backup activation remain open in [#251](https://github.com/0cwa/matrix-calendar-widget/issues/251). The pilot's scoped authority and private target facts are retained in their operator record; broader rollout and registry publication remain separate decisions.

## Next work

The [roadmap](./ROADMAP.md) owns dependency order. Continue source work in small reviewed slices, qualify any replacement candidate against its exact SHA, and complete the bounded operator pilot. Legacy server retirement #277 remains gated by that pilot unless explicitly re-scoped; package/fixture cleanup #278 follows it. Do not bundle dependency migrations or feature work into a documentation cleanup.

## Historical detail

The [archived status notes](./archive/status-2026-10-21.md) preserve previous test counts, failed attempts, source-specific acceptance, and work chronology. The [milestone history](./archive/implementation-history.md) preserves the detailed completed slices. Use those records for provenance, not as an additional current checklist.
