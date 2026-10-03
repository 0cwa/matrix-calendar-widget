# Remote inventory

Captured at **2026-10-03 14:17 UTC**. Recheck live refs, checks, and issue status before acting; this is a timestamped snapshot. The handoff documentation is intended for `codex/web-handoff-20261003` under `docs/handoff/2026-10-03/`.

## Repository and open work

- Repository: [0cwa/matrix-calendar-widget](https://github.com/0cwa/matrix-calendar-widget).
- Live `main`: `f24a4979a052b2a293144b3192eeee0cc2e17fa6`.
- Open project issues: #5 M4, #6 M5, #7 M6, #8 M7, and #9 M8.

| PR | Head | State at capture | Exact-head check evidence and outstanding gate |
| --- | --- | --- | --- |
| [#164](https://github.com/0cwa/matrix-calendar-widget/pull/164) | `b736d8f26b5bb36d39e7a20ed13924d39c84099a` | Draft | Quality, Server and bot, Widget, CodeQL, and container smoke passed. Real Radicale contract failed in run `37125383344`, job `111209519545`, at 13:14:26 UTC. The room setup marker was not reached; the sanitized artifact has no assertion, exception, or source frame. Both disabled-contract import preflights pass. Do not interpret the room labels as executed assertions or merge until the setup failure is diagnosed and real contracts pass. |
| [#177](https://github.com/0cwa/matrix-calendar-widget/pull/177) | `316c388e0e85eb210de1d49ab92b7b1c91693744` | Draft | All hosted checks passed. Widget job `111210747026` in run `37125807638` completed at 13:26:59 UTC. Independent review is withheld: English and German duration-unit localization keys are missing. |
| [#178](https://github.com/0cwa/matrix-calendar-widget/pull/178) | `3661a97a889294f2326a97e4ed109400d4aa94ce` | Draft | All hosted checks passed. Widget job `111212707580` in run `37126493606` completed at 13:37:21 UTC. Independent content/security review and the required PLAN sync remain pending. |
| [#179](https://github.com/0cwa/matrix-calendar-widget/pull/179) | `84215fbf55f884ff94e5a298a182a275b59f811b` | Draft | All exact-head hosted checks passed. Widget job `111213751348` in run `37126839185` completed at 13:42:49 UTC; Quality, Server and bot, container smoke, CodeQL, and Analyze JavaScript/TypeScript passed as well. Local clean Node 22.23.3 / Yarn 1.22.22 `yarn ci` passed. Independent review and merge remain pending. |

All four PRs were based on live `main` above when captured. PR #179 contains `package.json` only and orders linked package prerequisites before aggregate tests. The `package.json` workspace fix does not close the separate #164 real Radicale setup failure.

## Preserved local-only work

The root checkout remains on stale local `main` at `3ed83753c989830c2209073df96ad7bedae6ecf9`; do not reset or use it as current `main`. Its two local-only commits are preserved on `codex/backup-local-main-20261003`, verified remotely at that exact head:

| Commit | Changed scope |
| --- | --- |
| `6d0217a218efaafdf321378df5afe2c52144a290` | Older PLAN/ROADMAP/STATUS guidance for Radicale and Matrix OpenID auth. |
| `3ed83753c989830c2209073df96ad7bedae6ecf9` | `AGENTS.md` and `.github/workflows/ci.yml` development/workflow guidance. |

Neither commit was reachable from the live remote refs checked before backup publication, and a patch-id comparison found no duplicate among the then-published refs. Preserve this branch for review; do not merge blindly.

Seven clean local M6 worktrees contained substantive history not reachable from published refs at discovery. Each exact original head is now preserved on a new remote backup ref. These are archival snapshots, not reviewed or integration-ready branches:

| Original local branch | Local worktree | Backup ref | Exact head |
| --- | --- | --- | --- |
| `codex/m6-reminder-alarm-uid` | `.tmp/mcw-m6-reminder-alarm-uid` | `codex/backup-m6-reminder-alarm-uid-20261003` | `d227de8ebcc7df932bf75404e7cfb13d48249ce2` |
| `codex/m6-reminder-config-api` | `.tmp/mcw-m6-reminder-config-api` | `codex/backup-m6-reminder-config-api-20261003` | `55bff4242320cb06ac51a0eaed4c3916720648a5` |
| `codex/m6-reminder-config-api-auth` | `.tmp/mcw-m6-reminder-config-api-auth` | `codex/backup-m6-reminder-config-api-auth-20261003` | `1f188a5e0d4021433828c0db7b470f10832acbb2` |
| `codex/m6-reminder-deployment` | `.tmp/mcw-m6-reminder-deployment` | `codex/backup-m6-reminder-deployment-20261003` | `ea920b8a3b7894bf0ec6b7f3e80e8ab81482a067` |
| `codex/m6-reminder-integrated` | `.tmp/mcw-m6-reminder-integrated` | `codex/backup-m6-reminder-integrated-20261003` | `101551a22b8197fa538a4f9f7b7c81efb5f6d942` |
| `codex/m6-reminder-postgres-store` | `.tmp/mcw-m6-reminder-postgres` | `codex/backup-m6-reminder-postgres-store-20261003` | `576b0ee437551b8f46266da17c75946935e636b4` |
| `codex/m6-room-reminder-auth` | `.tmp/mcw-m6-room-reminder-auth` | `codex/backup-m6-room-reminder-auth-20261003` | `611395561524fbf2aef80324897f56babc69a2d7` |

At capture all seven worktrees had no tracked modifications. The only credential-scan finding was in the same unchanged `matrix-calendar-server/test/middleware/MatrixAuthMiddleware.test.ts` unit-test blob in each branch. It imports `jest-fetch-mock`, enables mocked fetch responses, uses fixed expired test data, and contains no direct real-network call. Both credential-shaped literals occur nowhere else in each tree. The exact original histories were preserved after this source-context check; no literal values were included in the handoff text. First publication attempt was rejected because the initial scan alone did not establish fixture context; the second request included the verified test-only/mock evidence and succeeded. No published ref was rewritten.

## Workspace and asset inventory

- The root checkout reports two commits ahead and 143 behind its stale local `origin/main`; against the live `main` above, it is two commits ahead and 147 behind. The two ahead commits are the preserved commits listed above. The checkout has not been reset.
- Five project clones under `tmp/` were clean at capture: #177 feature head `316c388e…`, stale main clone `1f10e9ab…`, #178 head `3661a97a…`, #179 comparison clone `84215fbf…`, and #164 repair clone `b736d8f2…`. All substantive PR code is on the exact remote PR refs above. The comparison and repair owners completed cleanup of their own generated assets.
- `tmp/tech-debt-report.html` is preserved and included in the handoff package. Other `tmp/` directories and branch refs were left untouched.
- The root checkout showed 5,929 untracked status entries: 5,731 under `.tmp/` were Node compile-cache files, 192 under `.agent-work/` were orchestration/work-unit evidence, and six under `tmp/` were the five project clones plus the report. No cache, dependency tree, raw log, or unfiltered assertion output is included in the handoff package. Other `.agent-work/` artifacts remain local; this inventory does not authorize blanket deletion.
- Several old Git worktree registrations point to missing disposable paths. Their local branch refs were left intact. They are not active clones and were not modified as part of this handoff.
- Process check found no Radicale, Synapse, Node, Yarn, or Vite processes. Read-only Podman check found `mixxx-build` and `sneakerapp-tauri-build-20261003` running; both are unrelated and remain untouched.

## Handoff method and evidence scope

- `codex` and `codex cloud --help` are present locally. The documented `cloud exec` command starts a new task and requires an environment; the read-only task listing failed in the backend and no repo environment could be resolved. No task was created. No direct current CLI-session to ChatGPT Work transfer command was available.
- The official OpenAI remote-connections documentation describes supported desktop-to-connected-host behavior, not a current-thread transfer: [Remote connections](https://learn.chatgpt.com/docs/remote-connections). The continuation therefore uses the committed handoff branch and a paste-ready README.
- The handoff package includes the current validated ledger/render, completion plan, debt report, remote inventory, selected audit/integration/review/widget evidence, #164 repair evidence, and #179 build-order evidence. No separate M8 scout evidence memo was found. The threat-model PR and its source document remain on #178.
- Formatter/runtime verification is documented separately: the publication is document-only; no runtime CI was run for these handoff files. Do not substitute an unlocked formatter if the repository-pinned binary is unavailable.
