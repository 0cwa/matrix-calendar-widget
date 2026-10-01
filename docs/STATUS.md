# Project status

_Last updated: 2026-10-01_

This is the short-lived execution snapshot. `docs/PLAN.md` is the durable milestone plan; GitHub issues contain acceptance criteria.

## Current phase

**M3 is complete. M4 description and color editing, mixed-collection compatibility, manager-only CalDAV URL/copy diagnostics, and hiding of VJOURNAL-only/VTODO-only collections are implemented; issue #5 remains open for other collection-management work, and collection timezone editing is deferred. PRs #128 and #130 merged bounded read-only recurrence projection/range clipping and the first supported whole-series RRULE create/edit slice. M5 recurrence work continues in bounded slices.**

ADR024 selects a clean-room, OpenID-only in-repository Radicale 3.8.0.0 Auth module and pinned project-owned image for #48. This change implements the adapter, image, focused tests, and direct real-Radicale authentication contract. The owned backend rejects untagged credentials, and Matrix-password CalDAV compatibility is intentionally unsupported and deferred in this pre-alpha. #45 remains open for the personal gateway's same-user enumeration and nonmember/failed-authorization denial before CalDAV I/O. M6 issue #7 owns appservice proof issuance after actor, membership, power, and exact binding checks, plus cross-room isolation. PR #132 adds binding validation and fail-closed membership/power policy; PR #133 wires the opt-in `target=room` preflight and stops before CalDAV I/O. Existing user-principal room-context routes remain active and make CalDAV requests as the authenticated user. Live room-calendar data and room-target diagnostics remain disabled until the M2 and M6 gates pass. The actual etke-host image override and `/data` replacement path have not been verified.

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
- a historical password-authenticated real-Radicale discovery contract for the
  prior deployment (this does not grant password support to the owned image).

The in-repository personal OpenID-to-Radicale adapter and owned image are under
implementation/review in #48; see **Active blockers**. The prior
password-authenticated contract records legacy deployment behavior only.

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

Issue #6 remains open. PR #128 completed bounded read-only projection and exact viewer-local range clipping. PR #130 adds whole-series RRULE creation/editing for DAILY, WEEKLY, MONTHLY, or YEARLY rules with a positive interval and never/count/inclusive-date endings. The current weekly BYDAY slice supports plain weekday sets for every-week rules when DTSTART's weekday is included, INTERVAL is absent or 1, COUNT/UNTIL and other rule parts are absent, and WKST is absent or its default MO. Unsupported weekly BYDAY combinations remain opaque and preserved. The widget also skips and restores one projected supported occurrence by adding or removing only its matching EXDATE, including when a detached override moved the display time. A separate bounded widget operation adds or removes one point-valued RDATE on a supported recurring master: DATE and DATE-TIME match DTSTART's value type, DATE-TIME keeps its floating/UTC/TZID form and local wall time even when its TZID differs from DTSTART, and a new TZID value requires a matching VTIMEZONE already present in the source VCALENDAR. Exact duplicate additions are no-ops, and EXDATE precedence is unchanged. PERIOD and malformed/unsupported RDATE values remain opaque. The editor supports one negative relative `ACTION:DISPLAY` VALARM trigger from DTSTART; multiple alarms, absolute or non-START triggers, unsupported actions, and repeating alarms stay opaque while other event fields remain editable. This setting changes CalDAV alarm metadata for clients that honor it; Matrix reminder delivery remains separate M6 work under ADR007. Codec regressions preserve recurrence value kind and wall time plus sibling EXDATEs, RDATE PERIODs, detached VEVENTs, VALARMs, and unknown resource data. General RDATE/EXDATE editing, additional rule patterns, instance-edit semantics, and broader recurrence interoperability remain open. These in-repository slices can proceed independently of the M2 authentication implementation; end-to-end use with a user's real CalDAV principal still depends on the M2 delegation path.

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

### M2 — Radicale OpenID authentication and delegation

- #48 remains open for implementation/review of the clean-room in-repository Radicale 3.8.0.0 Auth module and pinned project-owned image under ADR024. Its current acceptance requires tagged short-lived OpenID credentials only, rejection of untagged credentials before homeserver I/O, focused validation/cache/log tests, and use of the owned image in dev/contract CI. Matrix-password CalDAV compatibility is unsupported and deferred in this pre-alpha; no external auth package is included or invoked.
- #45 remains open for the M2 real-Radicale personal actor contract: same-user calendar enumeration and denial of non-members or failed authorization lookups before CalDAV I/O, after #48.

The selected implementation is in-repository; it does not depend on a change to or copied source from `radicale-auth-matrix`. Whether the actual etke-managed host accepts a custom image override while preserving its current `/data` store, configuration, and service lifecycle remains unconfirmed and must be verified before rollout.

### M6 — Room-owned application principal

ADR014 / ADR015 select the room-owned application-principal model and operator-managed static room binding. PR #132 adds binding validation/resolution and a fail-closed membership/power policy service. PR #133 wires the opt-in `target=room` zero-I/O preflight: it checks current joined membership and power before resolving the static binding, then stops at the disabled access gate without CalDAV I/O. Existing user-principal room-context routes remain active and make CalDAV requests as the authenticated user. M6 issue #7 owns the appservice-principal OpenID proof exchange, authorized issuance, and real-Radicale contract, as well as cross-room isolation. M2 #48/#45 validate only personal actor delegation and same-user enumeration; they do not validate appservice credentials or room isolation. With `owner_only`, the appservice principal can access its whole Radicale home, so the gateway binding alone is not backend isolation. Until issue #7 and the etke image/data path are verified, live room-calendar data access and room-target diagnostics remain disabled. Matrix event sender data is authorization/audit context, not OpenID or CalDAV identity proof. Issue #7 remains open for real room-calendar operations. Start reminder delivery with permission-checked room-wide notifications using standard `m.mentions.room: true`, rechecking permission at delivery time. Individual Matrix-recipient selection is outside the accepted v1 scope and requires a later explicit scope decision. Email attendee/address collection is separately deferred until members explicitly verify and consent to share an address. Per-user bot calendars are deferred until a trusted actor-token path is independently defined and tested.

### M7 — Data commands

Issue #8 remains open after the help-only PR #105. `upcoming`, `event`, create, and delete/cancel commands depend on the M6 room-owned calendar binding and authorization contracts; do not implement them by treating a room sender as CalDAV identity.

### M8 — Deployment verification

After authentication and runtime configuration are defined, verify the Docker-compatible services on the operator's etke-managed host. The deployment profile still needs host-specific service ownership/lifecycle, playbook or host interface, network and proxy/TLS/public URL, secrets, persistent storage, and PostgreSQL access for reminder state. Build-smoke success and deployment documentation are not deployment evidence. Issue #9 remains open.

### Repository administration

Issue #29 remains open for a repository administrator to enable and verify the documented `main` branch protection rules. This is an administrative task, separate from the feature and deployment blockers above.

## Highest-priority next steps

1. Keep M4 timezone editing deferred until its CalDAV compatibility boundary is established.
2. Advance M5 through bounded recurrence and round-trip slices, adding DST and named-timezone regressions with each relevant behavior.
3. Implement the OpenID-only Radicale 3.8 adapter and pinned image for #48, then complete #45 for personal same-user enumeration and fail-closed denial against real Radicale.
4. Complete M6 issue #7's appservice proof exchange, room authorization, real-Radicale access, and cross-room isolation, then verify the etke image override preserves `/data`. The `target=room` preflight is wired and stops before CalDAV; keep it disabled until all gates pass.
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
