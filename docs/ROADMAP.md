# Roadmap — delivery first, then a smaller calendar architecture

_Status: 2026-10-19. Pre-alpha; candidate qualification and operator evidence remain incomplete. Execute only within recorded, target-specific owner authorization._

This page describes **sequencing**, not release acceptance. The [roadmap issue #273](https://github.com/0cwa/matrix-calendar-widget/issues/273) is the issue-level priority/dependency index; [docs/RELEASE.md](./RELEASE.md) is the source-bound release gate; [docs/beta-scope.md](./beta-scope.md) defines what the controlled pilot must prove. [docs/STATUS.md](./STATUS.md) records evolving evidence, and [docs/PLAN.md](./PLAN.md) retains the detailed M0–M8 implementation history. When those records disagree, do not infer readiness from historical test success: reconcile the actual source SHA and evidence in #255.

## Engineering decision

**Keep the existing CalDAV/Matrix implementation. Do not restart, replatform, split it into microservices, or rewrite the preservation-first iCalendar codec.** The immediate objective is to get one small, reversible pilot qualified and running. Widget startup and route cleanup (#275/#276) were explicitly re-scoped and completed before the pilot; remaining server retirement (#277) stays gated on the pilot. The longer-term objective is to remove NeoDateFix meeting runtime dependencies from the normal calendar path and make calendar changes cheaper to implement and validate.

Radicale/CalDAV stays canonical for calendar data; the app-owned PostgreSQL store stays separate for reminder state. Matrix identity, room membership/power/binding checks and server-side authorization stay mandatory. The Matrix widget is the primary UI and bounded `!calendar` commands remain a fallback.

## Priority order

| Order                                           | Workstream                                                                                                                                                                                     | Issues                                              | Exit / blocking rule                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 completed: pilot-correctness foundations** | Calendar-only root, fail-closed inherited meeting entry points, Matrix v12 creator permissions                                                                                                 | #274, #259, #282                                    | Implementations merged and issues closed. Their tests/evidence **must still be refreshed on the eventual candidate**; closure is not deployment acceptance. |
| **P0 active: exact-source qualification**       | Continue the source-bound release gate. PR #317 reconciled `docs/RELEASE.md`, but #255 remains open for exact-source qualification and evidence.                                               | #255, #9                                            | Do not use earlier SHA evidence to bless a changed candidate. Do not weaken protected checks or security/performance limits.                                |
| **P0 active: approved operator pilot**          | Continue the scoped #251 pilot after source/runtime evidence and target/recovery gates pass. The latest public update says services remain stopped pending a reviewed materializer correction. | #251                                                | Keep actions within recorded target-specific authority and all source, target and recovery gates. Wider rollout still requires a separate decision.         |
| **P1 scoped source cleanup**                    | **Complete:** #275 Redux/invitation startup removal and #276 widget-route retirement. **Gated:** retire legacy server handlers in a separately reviewed slice.                                 | #275, #276 complete; #277 after #251                | #277 remains gated on the pilot under #251 (or explicit re-scope). Preserve calendar behavior and qualify any source change against its exact SHA.          |
| **P2 follow-on maintenance**                    | #278 consolidation follows #277. #256 is closed, with feedback/telemetry deliverables still outstanding; #257 remains evidence-triggered; #258's bounded extraction is complete.               | #278 after #277; #256 residual; #257; #258 complete | Keep #278 blocked until #277; measure feedback and change-radius outcomes without weakening critical behavior or exact-source certification.                |
| **Deferred feature expansion**                  | Collection timezone, advanced recurrence and broad interoperability                                                                                                                            | #5, #6                                              | Re-prioritize only after operational evidence and a deliberate scope decision.                                                                              |

**P0 pilot boundary:** One room / two accounts; operator can repeat recovery.

**Scope lock for the pilot:** Element Web/Desktop standard side panel; `bot-account` full browser acceptance and mandatory both-mode backend/CalDAV contracts; one gateway replica; independent project-owned Radicale store and app-owned PostgreSQL reminder store. Mobile, existing managed Radicale `/data` reuse, arbitrary recurrence authoring and additional UI layouts are not pilot blockers. See beta-scope for exact limits.

## Three validation layers

1. **Fast change feedback:** run changed-workspace tests/type/lint and deterministic fixture checks while implementing a small vertical slice. The goal is a short, actionable first failure, not an alternative acceptance standard.
2. **Required PR checks:** retain all current protected CI contexts and affected integration contracts. Targeted tests supplement — never silently replace — required checks.
3. **Source-bound release certification:** run the complete approved Element Web/Desktop, real CalDAV/identity/authorization, image, recovery and operator-rehearsal evidence for the **frozen SHA**. Hosted fixtures do not establish production-host acceptance.

See [DEVELOPMENT.md](./DEVELOPMENT.md) and #256. Keep major dependency upgrades outside a frozen candidate except for independently justified blockers. Freeze only after planned P0 source changes are integrated; if a blocker changes the SHA, record the new candidate and rerun relevant required evidence.

## Architecture direction and constraints

- **Widget:** calendar home and editor depend on `CalendarRepository`, domain types and the Matrix Widget API, not NeoDate meeting Redux or meeting routes. Issues #275 and #276 are complete; legacy deep links keep their tested redirect to calendar home.
- **Gateway:** transport validation and permission checks wrap calendar use cases; do not make frontend capabilities an authorization boundary. Retire unreachable meeting controllers/services after pilot (#277), not as an untested pre-pilot rewrite.
- **CalDAV:** keep the stable codec facade and unknown-property round-trip semantics; incrementally isolate projection, recurrence, patching and serialization **only when that reduces actual change radius** (#257).
- **UI transport:** the bounded editor-state/presentation extraction is complete in #258; preserve ETags, focus/keyboard behavior and the wire protocol.
- **Boundary enforcement:** after legacy runtime retirement, add a small, explicitly allowlisted import-boundary check so new calendar modules cannot reintroduce meeting UI/Redux dependencies (#278). Do not assume every inherited import is unused without tracing it.

No new ADR is needed merely to restate this sequence. Changes to persistence, auth, public API, permissions, calendar semantics or deployment topology still need an ADR under [AGENTS.md](../AGENTS.md).

## Measure improvement, not just activity

Complete #256's remaining feedback/telemetry work despite the issue's closed state: record time to first actionable developer test failure, the five protected-check durations, full certification duration, setup-only failed runs, and test-harness change radius; document the existing fast local/workspace route and add the sparse-checkout/static-import regression. Compare later bounded work against that baseline. Further #257 codec/controller extraction is justified only by a concrete change that demonstrates avoidable change radius. Do **not** trade away preservation, auth, recovery or accessibility checks to improve these numbers.

## Not now

No big-bang architecture rewrite, new service split, wholesale dependency upgrades, cosmetic file-size refactors, or broad feature additions as conditions for the first pilot. Archive NeoDate provenance and copyright notices even when live code is retired.
