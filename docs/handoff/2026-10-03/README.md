# Matrix Calendar Widget — web Work continuation

You are taking over an active project from a local Codex session. Orchestrate the remaining development to completion. First verify the live repository and PR state below.

## Repository, authority, and working rules

- Repository: https://github.com/0cwa/matrix-calendar-widget. The user describes this development repository as pre-release, with breaking changes allowed and not deployed yet.
- The user explicitly authorizes same-repository development, commits, pushes, draft PRs, ready transitions, and merges without repeated confirmation. Do not open PRs to anyone else's repository without approval. This does not authorize bypassing platform/sandbox controls, rewriting published refs, or deploying live etke services.
- Read `AGENTS.md`, `README.md`, `docs/STATUS.md`, `docs/PLAN.md`, `docs/ARCHITECTURE.md`, `docs/UPSTREAM.md`, and fork ADRs starting at ADR004. ADR001–003 are inherited historical context. Accepted fork ADRs govern their stated decisions.
- Act as orchestrator: delegate source investigation, implementation, and independent reviews. Keep one owner per branch/write surface; serialize shared PLAN/STATUS edits and integration. If available, use Luna medium for scouts and Luna max for implementation/review; use the closest available model otherwise. Use Sol/Astra only for bounded judgment calls with research supplied. Be patient with agents and demand precise evidence rather than jargon.
- Work from current remote `main` in fresh feature branches, record exact base/head, preserve normal forward-only pushes, and do not force-push published refs. Before each GitHub mutation re-read current base/head/files/checks; verify the resulting remote state afterward. The repo requires up-to-date PR branches, so merge candidates sequentially and refresh others afterward.
- Use repository-locked tools. Applicable completion gates are `yarn prettier:check`, `yarn lint`, `yarn tsc`, `yarn test:all`, `yarn build`, or aggregate `yarn ci`; packages also have applicable dependency checks. Tests accompany behavior changes; iCalendar changes require preserved unknown properties and round-trip fixtures.
- Use `./tmp` for disposable work, clean owned assets as you go, preserve the technical-debt report. Never output GitHub tokens, Matrix passwords/access tokens, OpenID assertions, CalDAV credentials, private keys, or raw credential-bearing logs. A scout's read-only assignment applies to that scout's scope, not the entire project or later authorized implementation.
- Enter goal mode for project completion if supported. The old local goal API remained in a stale blocked state and had no agent resume action; work nevertheless progressed. Do not copy that stale blocker into a fresh goal.

## Verified baseline

At this handoff, remote `main` is `f24a4979a052b2a293144b3192eeee0cc2e17fa6`. Re-read it before acting. Continuation artifacts are on branch `codex/web-handoff-20261003`, under `docs/handoff/2026-10-03/`: https://github.com/0cwa/matrix-calendar-widget/tree/codex/web-handoff-20261003/docs/handoff/2026-10-03 . This includes a final remote inventory, validated work ledger, rendered ledger handoff, completion plan, debt report, and scoped evidence. Treat the timestamped remote inventory as authoritative if later checks differ from this text.

Merged in this session, each with independent exact-head review and passing required hosted checks:

| PR | Delivered | Resulting main |
| --- | --- | --- |
| #166 | Existing typed EXDATE removal in widget editor | `8bf300f45798a2e88a7596f2a5959150f6d0da8a` |
| #167 | Multi-day all-day DATE recurrence across Stockholm fall-back/half-open windows | `1f10e9abc959a5b912400b5d01a45ea38407c829` |
| #171 | Pure reminder trigger-time helper; nominal days/weeks versus elapsed smaller units | `948bf00286363ea91bc97c8d5655987b6e15dff9` |
| #175 | Duration-form PERIOD RDATE model/codec/in-memory support | `fd55c1ce16727fcccf10486576ca5caf2241b25b` |
| #176 | Stateless bot `--tz <IANA zone>` parser, UTC default | `f24a4979a052b2a293144b3192eeee0cc2e17fa6` |

Earlier completed work includes bot help (#173), backup/recovery docs (#170), etke deployment docs (#172), pre-alpha release policy (#174), and explicit-end PERIOD creation (#169). PostgreSQL reminder persistence/claim/lease/retry foundations already exist from #111; do not create a second store.

## Open draft work — all code pushed

### PR #164: room application-principal reads; unresolved real contract

https://github.com/0cwa/matrix-calendar-widget/pull/164

- Branch `codex/m6-appservice-room-access-20261002`; head `b736d8f26b5bb36d39e7a20ed13924d39c84099a`; base is the baseline above.
- Adds only the first room-target `listEvents` read path. Room mutations remain disabled; the application-principal feature gate defaults disabled. It checks current actor membership/power and exact static room/calendar binding before proof issuance or CalDAV I/O. Proof subject is the service principal, not the sender.
- Preliminary independent source review found no auth/data-boundary defect. The service principal's Radicale `owner_only` policy grants its whole home; cross-room isolation is the gateway's exact binding, not backend collection isolation. Do not claim more than the tests establish.
- A confirmed type error was fixed: the integration file imported Express `Response`, shadowing Fetch `Response`. Repair commit `ee1d0b8` aliases ExpressResponse; cleanup `072d4eb` removes ineffective diagnostic probes and retains direct pre-container compilation/import preflight. Both are included in the pushed head after forward merging current main.
- Ordinary required hosted checks pass. **Real Radicale contract fails**, workflow run `37125383344`, job `111209519545`. Personal setup completes; room AppService setup marker is not reached. Sanitized output marks three room case labels failed but retains no assertion count, exception, or source frame. These labels do not prove the assertions executed. Actual room setup cause is unknown.
- Node 22 disabled-contract import preflights for both personal and room integration files pass, so the room file's compile/module load is ruled out at this head. Local full Server/bot tests pass when loopback listeners are permitted. Local EPERM failures came from the sandbox blocking test listeners. A separate main TS2322 report disappeared after rebuilding current-main workspace libraries; it was stale generated/link output, not a source regression.
- Do not merge/enable room access until real personal+room/cross-room contracts pass and the final current-base head is independently reviewed.

### PR #177: widget duration PERIOD entry; localization finding

https://github.com/0cwa/matrix-calendar-widget/pull/177

- Branch `codex/m5-duration-period-widget-20261003`; head `316c388e0e85eb210de1d49ab92b7b1c91693744`; same base.
- Timed recurring-master duration entry, compact Weeks/Days/Hours/Minutes/Seconds group, positive safe-integer shape (weeks alone or days/time), typed floating/UTC/TZID start preservation. Existing point RDATE and all-day point paths remain supported. Existing PERIOD values can still be removed; timing edits are pending.
- Local 49 focused tests, locked formatting/import plugin, widget lint/types, translation extraction, diff check, and Impeccable detector passed. All hosted checks subsequently passed (run `37125807638`). PLAN adds #167's missing completion bullet; ADR023 status now includes widget duration entry.
- **Independent review withheld PASS:** `CalendarEventEditorDialog.tsx` constructs dynamic `calendarEvents.editor.durationWeeks`/Days/Hours/Minutes/Seconds keys with English defaults, but EN/DE files lack these keys. German viewers see English unit labels. Use extractable localized keys (or valid existing keys), add EN/DE translations, verify extraction/focused tests, forward-push, and re-review the exact follow-up.

### PR #178: M8 threat-model draft

https://github.com/0cwa/matrix-calendar-widget/pull/178

- Branch `docs/m8-threat-model-20261003`; head `3661a97a889294f2326a97e4ed109400d4aa94ce`; same base. Changes only README, SECURITY, and `docs/threat-model.md`.
- Local Markdown links/line anchors and diff check passed. Hosted checks passed (run `37126493606`). **Independent content/security review and PLAN completion remain pending.** Do not check off the threat-model gate until reviewed.
- Verified residuals include no gateway rate limiter and CalDAV discovery resolving peer-returned principal/home hrefs without configured-origin/base confinement. `CalDavDiscoveryClient.ts:399–420` resolves URLs; `:445–459` attaches credential-provider headers before follow-up PROPFIND. This concern involves a malicious/compromised configured CalDAV peer/response, distinct from caller URL validation in `CalendarGatewayController`. Redirect credential behavior is unverified; do not claim a demonstrated leak.
- The document distinguishes current main, gated #164, future reminders/room writes, and unverified operator facts. Required PLAN sync after review: mark “Threat model and security review” complete, with remaining risks tracked.

### PR #179: aggregate CI prerequisite ordering

https://github.com/0cwa/matrix-calendar-widget/pull/179

- Branch `codex/ci-prerequisite-build-order-20261003`; head `84215fbf55f884ff94e5a298a182a275b59f811b`; same base; `package.json` only.
- Fresh aggregate `yarn ci` failed because it tested linked packages before their required built output existed. Hosted Widget already built timezone/calendar packages first. This separate fix makes aggregate CI build prerequisites in the correct order.
- Full clean/current-main `yarn ci` passed on Node 22.23.3 / Yarn 1.22.22. Commit hooks passed dependency checking, locked formatting, and translation dry-run. Latest exact-head hosted checks were re-read at 2026-10-03 13:42:49 UTC and all passed. Independent review/merge remains pending; see the timestamped remote inventory for run and job IDs.

## Accepted product decisions — preserve these

- Radicale/CalDAV remains canonical; newly created collections are VEVENT-only. Preserve existing mixed collections/unsupported members and unknown iCalendar properties. No VTODO/VJOURNAL surface in v1.
- Widget is primary; bot is fallback. No user Matrix password at any layer. Browser persistence must not hold Matrix access tokens or CalDAV credentials.
- Widget expands/displays DATE and floating recurrence in viewer local time. Bot defaults UTC and accepts explicit IANA timezone per message; #176 is only the parser, not completed data commands.
- Mixed identities: widget personal calendars use validated user identity; room calendars use the server application principal after current membership/power/exact binding checks. Sender ID is authorization/audit input, not OpenID proof. Per-user bot targets can follow later when trusted actor proof is available.
- Whole-room reminders use standard `m.mentions.room:true` with permissions and send-time rechecks. Email attendee registration/consent is deferred. Matrix reminder recipients are sidecar metadata, not overloaded iCalendar fields.
- One server replica initially; app-owned durable PostgreSQL state and scalable claim/lease coordination seam. Do not access the homeserver's private database schema.
- Collection timezone metadata editing is explicitly deferred. MSC4496 is compatibility target only while unstable.
- Deployment target is etke using docker-matrix-ansible-deploy, with a separate calendar Docker service permitted. Actual custom image override, `/data` preservation/lifecycle, proxy/public URL/TLS/secrets, PostgreSQL access/TLS and restore rehearsal need operator evidence. These external checks do not block repository-side development.

## Remaining project development

- **M5 / #6:** finish #177, existing PERIOD timing editing, bounded broader RRULE patterns, RECURRENCE-ID overrides and instance/following/series scopes, further timezone/DST/interoperability fixtures, SEQUENCE/timestamps, organizer/attendee round trips consistent with deferred email registration, safe attachment/conference handling, broader alarms. Scope each slice from current PLAN/issues; do not assume every item needs a broad redesign.
- **M6 / #7:** prove #164; implement remaining authorized room writes; reuse existing store/trigger/policy/message foundations; review preserved resolver/scheduler work before implementing missing wiring; re-resolve current binding and send permissions; add room/RTC links. Keep delivery disabled until relevant contracts pass.
- **M7 / #8:** help is complete; timezone parser merged. Authorized `upcoming`, `event`, `create`, `delete` and useful fallback messages remain. Reads depend on proven M6 room access; writes require its write seam.
- **M8 / #9:** review #178; bounded rate/abuse controls, free/busy privacy policy, upgrade/migration runbook, current calendar UI responsive/accessibility evidence (existing axe tests cover inherited meetings), actual Matrix client compatibility matrix, measured large/recurring-calendar performance. Backup/recovery, owned deployment docs and pre-alpha release policy have repository-side completion; operator proof remains distinct.
- **M4 / #5:** collection timezone editing is the explicitly deferred remainder.

The audit found no evidence for a broad architectural refactor. Stale EXDATE tracking dependencies were corrected. Avoid generic “clean up debt” instructions; prefer concrete deterministic gates, such as compiling opt-in contracts before containers and building linked prerequisites before tests.

## Local workspace preservation

The old root checkout is stale and must not be used as current main. Two local-only commits (`6d0217a2`, `3ed83753`) affect older plan/status guidance and AGENTS/CI; they are preserved on `codex/backup-local-main-20261003`. They were not reachable or patch-duplicated in the checked live refs. Seven substantive M6 snapshots are also preserved on the refs below. These refs are historical, unreviewed material; compare them with current ADRs and main before reuse, and never merge them blindly.

| Local M6 branch | Backup ref | Preserved head |
| --- | --- | --- |
| `codex/m6-reminder-alarm-uid` | `codex/backup-m6-reminder-alarm-uid-20261003` | `d227de8ebcc7df932bf75404e7cfb13d48249ce2` |
| `codex/m6-reminder-config-api` | `codex/backup-m6-reminder-config-api-20261003` | `55bff4242320cb06ac51a0eaed4c3916720648a5` |
| `codex/m6-reminder-config-api-auth` | `codex/backup-m6-reminder-config-api-auth-20261003` | `1f188a5e0d4021433828c0db7b470f10832acbb2` |
| `codex/m6-reminder-deployment` | `codex/backup-m6-reminder-deployment-20261003` | `ea920b8a3b7894bf0ec6b7f3e80e8ab81482a067` |
| `codex/m6-reminder-integrated` | `codex/backup-m6-reminder-integrated-20261003` | `101551a22b8197fa538a4f9f7b7c81efb5f6d942` |
| `codex/m6-reminder-postgres-store` | `codex/backup-m6-reminder-postgres-store-20261003` | `576b0ee437551b8f46266da17c75946935e636b4` |
| `codex/m6-room-reminder-auth` | `codex/backup-m6-room-reminder-auth-20261003` | `611395561524fbf2aef80324897f56babc69a2d7` |

The flagged credential-shaped values occur only in one unchanged middleware unit-test fixture across those seven trees. That test uses `jest-fetch-mock` with mocked responses and a fixed 2021 expiry; no literal value was copied into this handoff. No runtime test caches, raw logs or unrelated Rust/native project work are included. The preserved technical-debt report remains available. At the latest process/container check, no Matrix test services or Node/Yarn/Vite processes were running; two unrelated build containers remained up and were left untouched. Fresh web work should start from live remote refs, not local tmp paths.

## Resume checks and ONE first action

1. Connect/open the specified GitHub repo. Read the required docs and `docs/handoff/2026-10-03/remote-inventory.md` on the handoff branch. Re-read live main and open #164/#177/#178/#179 heads/checks; compare with the hashes above. Do not infer completion from old green checks or draft status.
2. Keep all branches/history and source findings; establish one branch owner and a separate reviewer for each current candidate. Create a fresh project goal if available.
3. **Selected first action: obtain the actual room AppService setup exception in #164.** Use the existing test/workflow and inspect beforeAll/setup behavior under Node 22 with correctly built workspace packages. Prefer a uniquely named isolated test stack or narrowly sanitized setup-error capture; do not reuse/delete existing Compose volumes. Both import preflights already pass. Existing workflow discarded the actual error, so do not repeat the opaque-label loop or invent an auth workaround. Emit only a useful error class/message/source frame after redacting credentials; retain no raw secret-bearing logs in published artifacts. Fix only the demonstrated cause, then prove real contracts and independently review the exact final head before merge.

In parallel, fix #177's localization finding and review #178/#179. After each merge refresh remaining branches onto actual main and rerun exact-head gates. Continue the ordered remaining slices and keep PLAN/STATUS truthful. Ask the user only for genuinely missing product decisions or external authority; same-repository routine actions are already authorized.
