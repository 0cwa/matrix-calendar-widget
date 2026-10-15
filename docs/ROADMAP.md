# Roadmap — delivery first, then a smaller calendar architecture

_Status: 2026-10-15. Pre-alpha; no production installation or wider rollout is approved._

This page describes **sequencing**, not release acceptance. The [roadmap issue #273](https://github.com/0cwa/matrix-calendar-widget/issues/273) is the issue-level priority/dependency index; [docs/RELEASE.md](./RELEASE.md) is the source-bound release gate; [docs/beta-scope.md](./beta-scope.md) defines what the controlled pilot must prove. [docs/STATUS.md](./STATUS.md) records evolving evidence, and [docs/PLAN.md](./PLAN.md) retains the detailed M0–M8 implementation history. When those records disagree, do not infer readiness from historical test success: reconcile the actual source SHA and evidence in #255.

## Engineering decision

**Keep the existing CalDAV/Matrix implementation. Do not restart, replatform, split it into microservices, or rewrite the preservation-first iCalendar codec.** The immediate objective is to get one small, reversible pilot qualified and running. The architectural objective *after* that pilot is to stop carrying NeoDateFix meeting runtime dependencies in the normal calendar path and make calendar changes cheaper to implement and validate.

Radicale/CalDAV stays canonical for calendar data; the app-owned PostgreSQL store stays separate for reminder state. Matrix identity, room membership/power/binding checks and server-side authorization stay mandatory. The Matrix widget is the primary UI and bounded `!calendar` commands remain a fallback.

## Priority order

| Order | Workstream | Issues | Exit / blocking rule |
| --- | --- | --- | --- |
| **P0 completed: pilot-correctness foundations** | Calendar-only root, fail-closed inherited meeting entry points, Matrix v12 creator permissions | #274, #259, #282 | Implementations merged and issues closed. Their tests/evidence **must still be refreshed on the eventual candidate**; closure is not deployment acceptance. |
| **P0 now: exact-source qualification** | Resolve operator-rehearsal failures; reconcile one immutable source, mode, run IDs and three-image manifest in the release gate | #255, #9 | No use of earlier SHA evidence to bless the new candidate. No weakening of protected checks or security/performance limits. |
| **P0 next: approved operator pilot** | Collect private target facts, verify image identities and backups, install only after explicit approval, rehearse disable/rollback and paired restore | #251 | One room / two accounts; operator can repeat recovery. Production mutation and broader rollout each require **separate explicit approval**. |
| **P1 after verified pilot** | Stop NeoDate Redux/invitation startup; retire dead meeting widget routes and server handlers in reversible slices | #275 → #276; #277 after #259 | Ordinary calendar startup and runtime imports have no inherited meeting product side effects or route dependencies. |
| **P2 after legacy retirement** | Remove proven-unused dependencies/assets/fixtures; contain acceptance harness; reduce editor, gateway and codec change radius | #278, #256, #257, #258 | Smaller blast radius and faster feedback, measured rather than claimed; retain all critical behavior and exact-source certification. |
| **Deferred feature expansion** | Collection timezone, advanced recurrence and broad interoperability | #5, #6 | Re-prioritize only after operational evidence and a deliberate scope decision. |

**Scope lock for the pilot:** Element Web/Desktop standard side panel; `bot-account` full browser acceptance and mandatory both-mode backend/CalDAV contracts; one gateway replica; independent project-owned Radicale store and app-owned PostgreSQL reminder store. Mobile, existing managed Radicale `/data` reuse, arbitrary recurrence authoring and additional UI layouts are not pilot blockers. See beta-scope for exact limits.

## Two kinds of development feedback

1. **Fast change feedback:** run changed-workspace tests/type/lint and deterministic fixture checks while implementing a small vertical slice. The goal is a short, actionable first failure, not an alternative acceptance standard.
2. **Required PR checks:** retain all current protected CI contexts and affected integration contracts. Targeted tests supplement — never silently replace — required checks.
3. **Source-bound release certification:** run the complete approved Element Web/Desktop, real CalDAV/identity/authorization, image, recovery and operator-rehearsal evidence for the **frozen SHA**. Hosted fixtures do not establish production-host acceptance.

See [DEVELOPMENT.md](./DEVELOPMENT.md) and #256. Keep major dependency upgrades outside a frozen candidate except for independently justified blockers. Freeze only after planned P0 source changes are integrated; if a blocker changes the SHA, record the new candidate and rerun relevant required evidence.

## Architecture direction and constraints

- **Widget:** calendar home and editor depend on `CalendarRepository`, domain types and the Matrix Widget API, not NeoDate meeting Redux or meeting routes. Extract proven reusable primitives before deleting inherited features (#275/#276).
- **Gateway:** transport validation and permission checks wrap calendar use cases; do not make frontend capabilities an authorization boundary. Retire unreachable meeting controllers/services after pilot (#277), not as an untested pre-pilot rewrite.
- **CalDAV:** keep the stable codec facade and unknown-property round-trip semantics; incrementally isolate projection, recurrence, patching and serialization **only when that reduces actual change radius** (#257).
- **UI transport:** separate editor state/presentation from gateway networking without changing ETags, focus/keyboard behavior or the wire protocol (#258).
- **Boundary enforcement:** after legacy runtime retirement, add a small, explicitly allowlisted import-boundary check so new calendar modules cannot reintroduce meeting UI/Redux dependencies (#278). Do not assume every inherited import is unused without tracing it.

No new ADR is needed merely to restate this sequence. Changes to persistence, auth, public API, permissions, calendar semantics or deployment topology still need an ADR under [AGENTS.md](../AGENTS.md).

## Measure improvement, not just activity

Record a baseline before #256–#258/#278 and compare after each bounded slice: time to first actionable developer test failure, full certification duration, failed runs caused by harness/setup rather than product behavior, and number of unrelated production modules touched per calendar change. Set targets only after a measured baseline. Do **not** trade away preservation, auth, recovery or accessibility checks to improve these numbers.

## Not now

No big-bang architecture rewrite, new service split, wholesale dependency upgrades, cosmetic file-size refactors, or broad feature additions as conditions for the first pilot. Archive NeoDate provenance and copyright notices even when live code is retired.
