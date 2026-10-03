# Project completion plan — current orchestration

## Authority and operation

User authorizes routine same-repository development, pushes, draft/ready PRs and merges without per-step confirmation. Use normal tool approval controls and branch protection. No external-repository PRs or live operator deployment without scope/authority. Root orchestrates; branch owners implement and separate reviewers inspect exact heads. Disposable files belong under `./tmp`; preserve the HTML debt report and clean owned artifacts.

## Completed checkpoint

- Technical debt audit against main8bf300f: no evidence for broad structural refactoring. Report and validated quality case saved.
- EXDATE removal PR166 merged8bf300f; existing PLAN correct, stale ledger dependency resolved.
- All-day viewer-local DST regression PR167 merged1f10e9a; PLAN coverage bullet assigned to widget lane.
- Reminder trigger helper PR171 merged948bf00286363ea91bc97c8d5655987b6e15dff9 after exact-head review and all hosted checks.
- Duration PERIOD backend PR175 mergedfd55c1ce16727fcccf10486576ca5caf2241b25b; widget implementation released.
- Bot timezone context PR176 mergedf24a4979a052b2a293144b3192eeee0cc2e17fa6; command consumers remain open.

## Active independent lanes

1. **Integration:** Initial five reviewed branches merged; integration lane now independently reviews repaired164. Normal serialized base-forward/check/review/merge because protection requires current base. Never force published refs.
2. **Debt repair/M6:** PR164 module-load failure. Reproduce pinned Node22/Yarn, obtain actual sanitized exception (hosted diagnostics previously discarded it), smallest fix, remove obsolete diagnostics when justified. Forward current main and prove personal OpenID plus real room access/cross-room denial. Keep gate disabled until proof.
3. **M5 widget:** duration PERIOD entry implementation active from published175; form/dialog/tests/locales/PLAN only. Separate exact-head review and full CI.
4. **M8:** exact issue9 scout complete; threat-model artifact and SECURITY link implementation active, no runtime policy changes and no shared PLAN edits.

## Remaining repository development

### M5 / issue6

- Duration-form PERIOD widget entry (active preparation).
- Existing PERIOD start/end/duration editing through codec/API/editor.
- Bounded RRULE pattern additions.
- RECURRENCE-ID overrides and explicit instance/following/series scopes.
- Remaining named-timezone/DST interoperability matrix.
- SEQUENCE and timestamp mutation semantics.
- Organizer/attendee interoperability consistent with deferred email-registration decision.
- Safe attachment/conference property handling.
- Broader alarm handling.

Each subsequent slice requires scouting current issue/PLAN acceptance and preserved unknown-property round-trip fixtures before implementation. Do not expand silently or treat unsupported features as complete. Collection timezone editing remains explicitly deferred.

### M6 / issue7

- Finish room-principal read/write proof and server-side current membership/power/exact binding.
- Wire saved whole-room reminder settings and occurrence/alarm identity resolution to durable existing PostgreSQL store.
- Due scan/claim/lease/retry/delivery lifecycle with stable Matrix transaction identity and send-time authorization.
- Widget reminder settings and current `m.mentions.room` policy.
- Real runtime contract/negative authorization cases.

One replica default, durable app-owned state; retain shared-storage coordination seams. Email attendee registration/disclosure consent remains deferred.

### M7 / issue8

- Help complete; UTC-default optional IANA timezone parser pending integration.
- Authorized room-calendar upcoming and event reads.
- Authorized create/delete fallback commands through canonical CalDAV operations.
- Timed display/query semantics and focused recurrence/timezone tests.

Data commands depend on validated M6 room-principal boundary, not etke production rehearsal.

### M8 / issue9

- Exact issue9 scout complete: accessibility (existing axe E2E only inherited meetings), threat model (artifact absent), abuse/rate limits (absent), free/busy privacy (policy absent), upgrade/migration runbook, real client compatibility matrix, measured large-calendar performance.
- Threat-model artifact is first active slice; describe current mitigations, gated164 behavior and residual risks accurately. Independent review plus centralized PLAN sync required.
- Implement repository-side evidence independently where boundaries stable.
- Release readiness evidence must distinguish automated repository contracts from live operator facts.

## External readiness

Etke/docker-matrix-ansible-deploy image override, `/data` preservation, production PostgreSQL TLS and backup/restore rehearsal need operator evidence. Prepare reviewable assets and requests; do not claim live verification. These do not block repository-side development.

## Next dispatch

Review repaired164 current-base candidate and its real contracts; widget implementation active. Reuse an available slot for bounded M8 scouting after review.

## Final local workspace reconciliation

The shared root checkout is stale and has local commits plus orchestration artifacts. Before final delivery, delegate a read-only comparison of the root-only commits against remote history, preserve recoverable local refs/artifacts, recover any useful unmerged changes, then align the working checkout with verified remote main through a reviewed reversible plan. Do not reset or delete local work blindly. This does not block isolated feature development.
