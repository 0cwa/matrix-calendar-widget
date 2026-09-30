# Project status

_Last updated: 2026-09-30_

This is the short-lived execution snapshot. `docs/PLAN.md` is the durable milestone plan; GitHub issues contain acceptance criteria.

## Current phase

**M3 is complete. M4 description and color editing, mixed-collection compatibility, manager-only CalDAV URL/copy diagnostics, and hiding of VJOURNAL-only/VTODO-only collections are implemented; issue #5 remains open for other collection-management work, and collection timezone editing is deferred. PRs #128 and #130 merged bounded read-only recurrence projection/range clipping and the first supported whole-series RRULE create/edit slice. M5 recurrence work continues in bounded slices.**

ADR014/ADR015 define the mixed-principal and static room-binding contracts. PR #132 adds binding validation and fail-closed membership/power policy; PR #133 wires the opt-in `target=room` authorization preflight, which checks membership and power before resolving the static binding and stops before CalDAV I/O. Existing user-principal room-context routes remain active and make CalDAV requests as the authenticated user. Live room-calendar data and room-target diagnostics remain disabled. M2's #48→#45→#3 path validates the same user's OpenID delegation to Radicale; it does not provide or validate bot/application-principal credentials. M6 still requires separate application-principal credential provisioning and validation, actor/membership/power/binding authorization, a Radicale contract under that principal, and cross-room isolation. Closing M2 does not satisfy these M6 gates. No etke-managed host deployment has been verified.

## Landed

### M1 — Calendar domain seam

Complete on `main`:

- calendar/event domain model and repository seam,
- in-memory repository,
- repository-backed calendar/list/editor UI,
- create/edit/delete mutation hooks and invalidation.

### M2 — Gateway identity and Radicale discovery

Merged in-repo:

- authenticated calendar gateway context and room membership/power authorization,
- request-scoped Matrix OpenID validation and user-scoped CalDAV credential provider,
- principal/home/calendar discovery,
- password-authenticated real Radicale discovery contract.

The final OpenID-to-Radicale path is still blocked on external plugin work; see **Active blockers**.

### M3 — VEVENT CRUD

Complete on `main`:

- preservation-first `ical.js` codec (#61 / PR #70),
- visible-range transport with ETags and conditional create/update/delete,
- authenticated room-authorized gateway CRUD and gateway-backed widget repository,
- visible conflict recovery,
- real Radicale two-client round-trip and stale-ETag contract (#66 / PR #90).

### M4 — Calendar management

Merged on `main`:

- calendar visibility, VEVENT-only creation, and writable-calendar rename (PRs #94, #96, #99),
- safe VEVENT-only calendar deletion (issue #100 closed by PR #101),
- description discovery and description-only editing through the user-scoped gateway (PR #106),
- calendar color editing through the user-scoped gateway (PR #108),
- mixed-collection compatibility notice and non-destructive VEVENT use (PR #109).

Calendar timezone editing is deferred. PR #109 verifies mixed-collection notice behavior, preserves sibling VTODO data during VEVENT edits, and excludes collections from discovery when they explicitly report a supported-component set without VEVENT. The CalDAV discovery regression now verifies both VJOURNAL-only and VTODO-only collections remain untouched and hidden. PR #113 implements and validates the manager-only CalDAV URL/copy diagnostics under ADR022. Issue #5 remains open for remaining collection-management acceptance work. Its body has been reconciled to record description and color editing, safe deletion, diagnostics, and mixed-collection handling as complete; collection-timezone editing remains deferred.

### M7 — Non-widget fallback

PR #105 merged `!calendar help` and guidance directing capable clients to the widget; issue #8's help criteria are complete. Issue #8 remains open for upcoming/event queries and data-changing commands, which depend on the M6 room-calendar binding and authorization path.

### M8 — Docker build and deployment groundwork

PR #102 merged Docker build/runtime documentation and a non-publishing CI image-build smoke. The smoke validates image builds, not deployment. The docs describe generic operator-run etke/MDAD compatibility only; the repository has no MDAD-native service definition or rollout integration, and no etke-managed host deployment has been verified. Helm/Kubernetes packaging remains optional later work.

## Active work

### M5 — Recurrence and iCalendar completeness

Issue #6 remains open. PR #128 completed bounded read-only projection and exact viewer-local range clipping. PR #130 adds whole-series RRULE creation/editing for DAILY, WEEKLY, MONTHLY, or YEARLY rules with a positive interval and never/count/inclusive-date endings. The current weekly BYDAY slice supports plain weekday sets for every-week rules when DTSTART's weekday is included, INTERVAL is absent or 1, COUNT/UNTIL and other rule parts are absent, and WKST is absent or its default MO. Unsupported weekly BYDAY combinations remain opaque and preserved. The widget also skips and restores one projected supported occurrence by adding or removing only its matching EXDATE, including when a detached override moved the display time. Codec regressions preserve recurrence value kind and wall time plus sibling EXDATEs, RDATE PERIODs, detached VEVENTs, VALARMs, and unknown resource data. General RDATE/EXDATE editing, additional rule patterns, instance-edit semantics, and broader recurrence interoperability remain open. These in-repository slices can proceed independently of the external authentication work; end-to-end use with a user's real CalDAV principal still depends on the M2 delegation path.

### M6 — PostgreSQL reminder persistence

The optional app-owned PostgreSQL store, schema migrations, transactional
claim/completion contract, verified-TLS default, and restricted-role PostgreSQL
16 CI contract are implemented. The hosted restricted-role contract passed all
five integration tests in run 36358734009, and independent review passed. Full
local project CI also passed; its PostgreSQL integration suite was skipped
because no database URL was configured. Production validation remains open: no
operator-controlled PostgreSQL endpoint or CA/certificate configuration has
been supplied, so production TLS/CA validation and runtime validation against
that endpoint have not been performed. etke-specific database wiring also
remains unverified. Persistence provides at-most-once database
claim/completion state; it does not enable the reminder scheduler or guarantee
exactly-once Matrix message delivery.

## Active blockers

### M2 — User-scoped OpenID delegation

- #48 remains open for an ADR009-compatible OpenID mode in `radicale-auth-matrix`, preserving password authentication. Its recorded next step is to obtain a writable plugin source/release path or an accepted upstream contribution path.
- #45 remains open for the final gateway/OpenID/non-member real-container contract and depends on #48.

These are the user's delegated CalDAV identity path. They do not establish credentials for the application principal. Whether etke will support a custom plugin/image path remains unconfirmed.

### M6 — Room-owned application principal

ADR014 / ADR015 select the room-owned application-principal model and operator-managed static room binding. PR #132 adds binding validation/resolution and a fail-closed membership/power policy service. PR #133 wires the opt-in `target=room` zero-I/O preflight: it checks current joined membership and power before resolving the static binding, then stops at the disabled access gate without CalDAV I/O. Existing user-principal room-context routes remain active and make CalDAV requests as the authenticated user. ADR014/015 retain the M2 OpenID-capable Radicale plugin as a prerequisite, but M2's #48→#45→#3 delegation contract validates the same user's OpenID identity and does not validate application-principal credentials. M6 separately requires bot/application-principal credential provisioning and validation, actor/membership/power/binding checks, a Radicale contract under that principal, and cross-room isolation. Closing M2 does not satisfy these M6 gates; until the M6 gates pass, live room-calendar data access and room-target diagnostics remain disabled. Matrix event sender data is authorization/audit context, not OpenID or CalDAV identity proof. Issue #7 remains open for real room-calendar operations. Start reminder delivery with permission-checked room-wide notifications using standard `m.mentions.room: true`, rechecking permission at delivery time. Individual Matrix-recipient selection is outside the accepted v1 scope and requires a later explicit scope decision. Email attendee/address collection is separately deferred until members explicitly verify and consent to share an address. Per-user bot calendars are deferred until a trusted actor-token path is independently defined and tested.

### M7 — Data commands

Issue #8 remains open after the help-only PR #105. `upcoming`, `event`, create, and delete/cancel commands depend on the M6 room-owned calendar binding and authorization contracts; do not implement them by treating a room sender as CalDAV identity.

### M8 — Deployment verification

After authentication and runtime configuration are defined, verify the Docker-compatible services on the operator's etke-managed host. The deployment profile still needs host-specific service ownership/lifecycle, playbook or host interface, network and proxy/TLS/public URL, secrets, persistent storage, and PostgreSQL access for reminder state. Build-smoke success and deployment documentation are not deployment evidence. Issue #9 remains open.

### Repository administration

Issue #29 remains open for a repository administrator to enable and verify the documented `main` branch protection rules. This is an administrative task, separate from the feature and deployment blockers above.

## Highest-priority next steps

1. Keep M4 timezone editing deferred until its CalDAV compatibility boundary is established.
2. Advance M5 through bounded recurrence and round-trip slices, adding DST and named-timezone regressions with each relevant behavior.
3. In parallel, establish a writable source/release path for #48, then complete #45 against the tested user-delegation mode.
4. Separately validate application-principal credential provisioning, a real-Radicale contract under that principal, actor/membership/power/binding checks, and cross-room isolation. M2's same-user OpenID delegation path remains a plugin-capability prerequisite, not proof that the application principal works or that its gates pass; the `target=room` preflight is already wired and stops before CalDAV.
5. Build M7 data commands on those M6 authorization contracts; help is already available.
6. Verify an operator-run deployment on the etke-managed host after the host-specific runtime contract is known.
7. Ask a repository administrator to complete #29 branch protection.

## Working rules

- Prefer short-lived branches directly from current `main`; avoid stacked PR chains unless a dependency requires them.
- Keep vertical slices small and tested; do not build a generic WebDAV administration framework.
- Keep CalDAV credentials server-side and do not expose them in the widget or logs.
- Treat the Matrix sender as authorization context and audit data, never as proof of OpenID or CalDAV identity.

## Baseline and tracking

- NeoDateFix upstream: `nordeck/matrix-meetings@2d3011f665af04c3cd376c388f7ae3bcb06bba25`
- milestone trackers: #1 (M0), #2 (M1), #3 (M2), #4–#9 (M3–M8)
- M3 implementation slices: #61–#66 — complete
