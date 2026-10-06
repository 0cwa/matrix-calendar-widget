# Repository continuation — 2026-10-06

This continuation records repository evidence for the pre-alpha project. Default-off capability and deployment acceptance remain gated.

_Accepted code baseline: `main` at `e772d7de6644332be4daeb97ee529f6d15e68800`, tree `b448ac05e55ceade141cc30e7dd5cdcc1e6b9b52`; captured 2026-10-06T19:46:13.498Z._

The four draft PRs in the original 2026-10-03 handoff (#164, #177, #178, and #179) are merged. Their exact final heads, merge commits, and passing hosted checks are recorded in [the ledger](ledger.json). Their old draft states are historical; use the current source baseline and acceptance boundaries below.

## Verified 2026-10-06 delivered slices

Each row passed independent exact-tree review and all applicable hosted checks before merge.

| PR   | Delivered                                                        | Merge                                      | Reviewed source tree                       |
| ---- | ---------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| #214 | Stabilize clock-sensitive upcoming-warning test                  | `d32dceb9bd7d1fbc17078ef986040d1940813142` | `63b37cf30bffd2631688765ef7f8a9457576b123` |
| #215 | Author one monthly ordinal weekday selector                      | `e2c4ee1f1269545557050ac938505007028be941` | `f4e38e69ddc1d082aae7a27e10aaef08a55b0417` |
| #213 | Synthetic member/manager room browser and reminder controls      | `69630543268c990605ab1936520956150f08d4c2` | `495dd64ba9b966055707ff4e149cbb8c1c470762` |
| #216 | Fixed 1,000-event list/month browser rendering measurements      | `4c25fa97d4e5a01cca9eaf675b62dfd7b82ec863` | `c0a1076bf9fcaab1f4b177481a472ee099937e14` |
| #217 | One safe HTTP(S) CONFERENCE URI and optional label               | `5c543da1a3e4f4fdb6c1724380e9cf9f1174451d` | `1068480e49b7edb9365d3a016bf20f7ac17627cd` |
| #220 | Selected-occurrence title/description/location set or inherit    | `151d3c713799a12f18dcb8a5cb307081399daff5` | `dae2891fe296d4fa6dbe8db3775a1e45f66f5142` |
| #219 | One safe HTTP(S) URI ATTACH operation on an unambiguous master   | `ba21aa48dd5afb3f0bba71d1e37eeb2ecc3db789` | `55bb081a0ab873f5da3763072b006e7fe7b34bbc` |
| #218 | One absolute UTC DISPLAY alarm and nominal day/week DST fixtures | `e772d7de6644332be4daeb97ee529f6d15e68800` | `b448ac05e55ceade141cc30e7dd5cdcc1e6b9b52` |

The room browser evidence uses synthetic member/manager fixtures. The 1,000-event benchmark uses prepared one-off data and measures root mount through populated list/month DOM and two animation frames; it is not a load, memory, full recurrence/render pipeline, or controlled capacity result.

Monthly ordinal authoring supports one first–fifth or last weekday selector; those rules are excluded from following edits. Following edits remain finite, count-bounded, and timing-only. Selected-occurrence text edits cover title, description, and location set/inherit only. Conference authoring covers one safe master HTTP(S) URI and optional label; attachment patches perform one URI operation on an unambiguous master, without fetching, uploads, or binary authoring. The absolute-alarm slice covers one non-repeating UTC DISPLAY alarm; ADR028 Matrix delivery remains relative-only.

## Accepted controlled beta boundary

PR #221 merged as `b73cdb61e30c20878a2cab282b6dc854130b92dd` defines Element Web/Desktop, one server replica, the independent project-owned Radicale store, and separate app-owned PostgreSQL reminder state. Preserve [beta scope](../../beta-scope.md) and ADR037. Existing etke-store reuse is optional and requires its additional evidence. PR #224 merged as `036300f317b55be18af923477c8377067478f3d0` adds a default-off Compose configuration preflight; configuration checks do not establish operator or production acceptance.

Actual isolated Element validation, two-identity authorization denials, stale-ETag conflicts, keyboard/focus acceptance, enabled unencrypted reminder delivery, restart and restore of both stores, a measured operator-approved pilot envelope, and operator review remain open. Mobile/other clients and formal screen-reader certification remain outside this bounded target. M4/M5/M8 remain open.

The separate [hosted Element Web acceptance draft (PR #225)](https://github.com/0cwa/matrix-calendar-widget/pull/225) remains unmerged. At observed head `1f9e2f4ca240e03a87ca1d54709bc8273b72ffef`, its eight ordinary checks passed and its dedicated Element Web acceptance check failed. Re-read the live head and inspect sanitized diagnostics before continuing that work; this draft does not establish client acceptance. The ledger records this observation separately from accepted source evidence.

## Workspace and evidence preservation

The local shell backend stopped returning even trivial read-only commands. Existing worktrees, dirty absolute-alarm work, and historical backup refs were preserved. Subsequent source candidates were reconstructed from immutable GitHub source blobs and reviewed against exact remote trees, with repository-locked tools and hosted gates. They are not claimed byte-identical to inaccessible local edits. No blind local reset or alignment was performed.

Normal server and contract diagnostics retain only counts. Temporary draft workflows expose approved source paths and numeric test locations while keeping messages, calendar values, assertion contents, and credentials private. These diagnostics supplement normal gates; they never replace them or alter test timeouts.

The temporary formatter helper PR #222 and location helper PR #223 are closed and unmerged. Both helper branches are preserved.

## Remaining acceptance

Keep independent access, writes, reminder configuration/delivery, and action-notice gates disabled until the operator accepts each capability. CalDAV remains canonical, the widget is primary, the bot is fallback, and browser persistence must not hold Matrix access tokens or CalDAV credentials. The partial projector can omit source forms; warnings cover diagnosed forms and do not guarantee a complete export.

Collection timezone editing, attendee/email registration and consent, individual Matrix recipients, arbitrary recurrence authoring and splitting, broader attachment/conference/alarm forms, and actual client/server interoperability remain deferred or open as documented in PLAN and STATUS.

The [historical handoff](https://github.com/0cwa/matrix-calendar-widget/tree/bf0fda4d04066a82f9b2e8dce7ac7109724f0dfe/docs/handoff/2026-10-03) remains on its original ref. Its [technical-debt report](https://github.com/0cwa/matrix-calendar-widget/blob/bf0fda4d04066a82f9b2e8dce7ac7109724f0dfe/docs/handoff/2026-10-03/tech-debt-report.html) retains blob `26a0bdf7d9a006ace33af08e251dc04302f33ea3`. The seven M6 backup refs match the recorded heads; the local-main backup still points to `3ed83753c989830c2209073df96ad7bedae6ecf9`. Preserve these artifacts and compare historical work before reuse. No evidence supports a broad architectural refactor.
