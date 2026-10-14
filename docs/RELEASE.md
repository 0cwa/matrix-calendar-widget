# Current release gate

**Decision: blocked. No target-install approval or production changes.** This public index contains sanitized evidence only. Target-specific operator facts, credentials, locations, rendered deployment configuration, and recovery details stay in the private operator record.

## Candidate

The gate results below record the pre-integration PR [#260](https://github.com/0cwa/matrix-calendar-widget/pull/260) candidate at head `3643166a972a4f9e42da0b005bf3b7e3b8233180`, tree `b25da53e7dd7709ae91ca351c4207c7c475d3933`, on `main` base `36e5dfbe3ee5a29d7749d28c52efde7a19eee17b`. That candidate used the normal bot account (`bot-account`) pilot principal, but its evidence does not carry over to the integrated source. PR #260 was forward-merged with the newer `main` source at `1de23e45e6835cf54de91722cb52830285b1caad` in integration commit `56ebedd97ffa778cb433707cbcd5a74beaafe5a7` (tree `529bd984f398ae1921b68189fa9a66c274e1b349`). The integrated source and its final scope documentation still require exact-source checks and review.

## Owner-approved pilot scope

The bounded pilot uses full Element Web/Desktop acceptance in `bot-account`
mode. Full appservice-mode Element Web/Desktop browser certification is
deferred until after beta. This changes only the browser-certification scope:
backend, identity/authentication, room authorization, and CalDAV contracts
remain required in both `appservice` and `bot-account` modes. The ordinary
normal-bot profile retains its strict 0/25-event limits: cold activation and
same-range refresh at or below 2,000 ms, each required decoded non-OpenID
calendar API response at or below 1,000 ms, and all five 25-event details
samples at or below 500 ms. No timing allowance is introduced. This scope
does not approve a production installation, publication, or rollout. The
historical candidate evidence below remains tied to its exact source and is
not acceptance evidence for the integrated source.

## Gate index

- **PASSED — Required repository checks.** All five strict branch-protection contexts passed on the exact candidate: Quality, Widget, Server and bot, Container image build smoke, and Analyze JavaScript/TypeScript. The additional Calendar browser-layout result also passed; it is not a protected context. CodeQL and the Real Radicale contract passed. Evidence: [CI run 38504762910](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38504762910), [CodeQL run 38504762929](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38504762929), and [Real Radicale contract 38504762908](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38504762908). Retain these results for exact head `3643166` only.
- **PASSED — Independent source review.** The exact candidate received independent review. Evidence: [candidate commit](https://github.com/0cwa/matrix-calendar-widget/commit/3643166a972a4f9e42da0b005bf3b7e3b8233180) and [PR #260](https://github.com/0cwa/matrix-calendar-widget/pull/260). Repeat review if its source diff changes.
- **PASSED — Normal-bot Element acceptance.** Exact-head run [38504762817](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38504762817) passed normal-bot Web/Desktop, CRUD, reminders and restart, paired Radicale/PostgreSQL restore, G6 preservation, cleanup, and browser-egress phases. Its ordinary 0/25-event profile met the declared limits. A later check row reused the original normal-bot result; it was not a second execution. Retain this pass for exact head `3643166` only.
- **FAILED on the prior candidate — Appservice Element acceptance.** On exact source `3643166`, the 25-event default-view sample missed the unchanged 2,000 ms limit twice: 2,001.651 ms and 2,004.426 ms. No cause is assigned, and this result is not reclassified as a pass. The owner-approved scope above defers full appservice browser certification until after beta; it grants no timing allowance.
- **DIAGNOSTIC ONLY — Separate experimental source.** Run [38565338850](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38565338850) on source [`d1b3578`](https://github.com/0cwa/matrix-calendar-widget/commit/d1b3578d71202ea41cb43946447dceaff5a43eee) passed the normal-bot 105-phase profile and the appservice ordinary timing sample. The appservice packaged Desktop journey then failed: an event POST returned 201, but the following room-range GET returned HTTP 429 without an events array. Appservice reminder, restart, and paired-restore phases were not reached. The final cleanup postcondition was omitted from the diagnostic evidence and remains unverified, not a reported cleanup failure. This run accepts neither candidate nor satisfies the current pilot gates; it remains diagnostic only.
- **BLOCKED — Current images and local checks.** No trusted current-source manifest/archive or immutable identities are recorded for any of the three images: widget, server, and project-owned Radicale. The CI image job is local build smoke only. Local engine/API compatibility and the current-candidate local gateway probe remain unverified; hosted normal-bot API/CRUD acceptance does not establish those checks.
- **BLOCKED — Local acceptance.** Source-bound five-service Stage B, current server image/cache/runtime rehearsal, and local paired-store restore remain incomplete. The reviewed local rehearsal tooling candidate is recorded at commit `3bc8c4c2143f5de8ce417d21132a42cce40daab9`; its source-only and fake-command evidence does not establish real-service or runtime acceptance. The reviewed Restic retention follow-up is commit `15a6b9b3f9d9fbbd5814d1bcbca16e8c014da4cc`. These reviewed commits were published on separate branches and are not part of the current `main` baseline. Native local runtime compatibility remains unknown.
- **BLOCKED — Private install packet and approval.** No target-install approval is granted. Privately prepare exact target facts, rendered configuration, scoped install/test and recovery plans, and disable/rollback steps; obtain one concrete, explicit production approval before installation or any target mutation. Operator and target facts remain unknown.
- **BLOCKED — Target acceptance and recovery.** No target installation, off-server backup, target restore, or target recovery is claimed. After explicit install approval, verify the selected target's Element side panel, member authorization, CRUD, stale-write rejection, reload, restart, encrypted off-server backup, paired Radicale/PostgreSQL restore, disable, and rollback. Restic 0.19.1, generic S3-compatible storage, daily scheduling, 30-day retention, dedicated pilot repository or prefix, and repository-wide prune authority and I/O budget are plan parameters, not verified target configuration.
- **BLOCKED — Broader rollout decision.** Decide separately after source, target acceptance, and recovery gates pass. A scoped installation approval is not a wider rollout decision.
- **N/A — Existing managed Radicale store reuse.** The baseline uses the project-owned image and an independent store. Reuse or migration needs separate compatibility and recovery evidence.
- **DEFERRED — Broader clients and features.** The pilot covers Element Web/Desktop in the standard side panel. Mobile/other clients, pinned/full-width layout, and advanced recurrence remain outside this candidate scope.

The observed `main` commit `36e5dfbe3ee5a29d7749d28c52efde7a19eee17b` and predecessor acceptance at `c8eec112` are historical evidence only; neither replaces checks on candidate `3643166`. See [#255](https://github.com/0cwa/matrix-calendar-widget/issues/255) for this index, [#251](https://github.com/0cwa/matrix-calendar-widget/issues/251) for the controlled pilot, and [#9](https://github.com/0cwa/matrix-calendar-widget/issues/9) for release direction.

The pilot ordinary-load target is 0/25 events, with startup and refresh at or below 2 seconds, details at or below 0.5 seconds, and API responses at or below 1 second. The 250-event timing run is diagnostic only.
