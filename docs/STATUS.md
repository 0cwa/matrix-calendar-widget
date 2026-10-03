# Project status

_Last updated: 2026-10-03_

This is the short-lived execution snapshot. `docs/PLAN.md` is the durable milestone plan; GitHub issues contain acceptance criteria.

## Current phase

**M3 is complete. M4 description and color editing, mixed-collection compatibility, manager-only CalDAV URL/copy diagnostics, and hiding of VJOURNAL-only/VTODO-only collections are implemented; issue #5 remains open for other collection-management work, and collection timezone editing is deferred. PRs #128 and #130 merged bounded read-only recurrence projection/range clipping and the first supported whole-series RRULE create/edit slice. M5 recurrence work continues in bounded slices.**

M2 personal OpenID access is complete on the pinned development stack (PRs #146/#147). PR #164 now proves the gated application-principal room `listEvents` path against pinned Synapse and project-owned Radicale, including subject binding and cross-room denial. All seven hosted checks passed at its independently reviewed final head. Actor membership, action power, and exact static binding are checked before application-principal proof or CalDAV I/O. Room mutations, room diagnostics, and reminder delivery remain disabled; their repository-side integration is the next M6 work. The actual etke image override, `/data` preservation, production PostgreSQL TLS/CA, and restore rehearsal still require operator evidence and are separate from repository development.

## Landed

### M1 — Calendar domain seam

Complete on `main`:

- calendar/event domain model and repository seam,
- in-memory repository,
- repository-backed calendar/list/editor UI,
- create/edit/delete mutation hooks and invalidation.

### M2 — Gateway identity and Radicale discovery

Complete on `main` for the pinned development stack (PRs #146 and #147):

- authenticated calendar gateway context and room membership/power authorization,
- request-scoped Matrix OpenID validation and user-scoped CalDAV credential provider,
- principal/home/calendar discovery and same-user personal calendar enumeration,
- denial of unauthorized, nonmember, and membership/authorization failure cases before CalDAV I/O,
- an OpenID-only owned Radicale image and real-container gateway contract.

The earlier password-authenticated real-Radicale discovery contract records
legacy deployment behavior only; it does not grant password support to the
owned image. These results validate the pinned Synapse and project-owned
Radicale stack, not the actual etke-managed host or its `/data` migration path.

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

PR #102 merged Docker build/runtime documentation and a non-publishing CI image-build smoke. PR #170 adds cold backup and isolated restore instructions for the project-owned Compose volumes and separate external PostgreSQL guidance; it does not cover etke-managed `/data`. PR #172 records the generic operator-run etke/MDAD compatibility boundary. The adopted pre-alpha release policy permits breaking changes and authorizes neither live deployment nor publication; future release gates remain. These documents and build smoke do not verify a live etke-managed host. The repository has no MDAD-native service definition or rollout integration. Helm/Kubernetes packaging remains optional later work.

## Active work

### M5 — Recurrence and iCalendar completeness

Issue #6 remains open. The domain projects bounded recurrence into exact viewer-local windows, and the editor supports the documented whole-series RRULE subset plus point RDATE and one-occurrence EXDATE skip/restore operations. Unsupported rules, timezone definitions, and mixed members remain opaque and preserved; see PLAN and ADR023 for the precise supported rule boundary.

PRs #169/#175/#177 add explicit-end and positive-duration PERIOD RDATEs through the codec/domain and localized widget duration entry. Floating, UTC, and named-TZID forms remain distinct. Existing PERIOD timing edits, broader weekly combinations, and scoped instance/following editing are under review or implementation and are not claimed complete on main. PR #183 defines supported SEQUENCE/timestamp revision updates while preserving unsupported metadata. Named-timezone/DST and half-open all-day regressions are merged.

The widget edits one supported negative relative DISPLAY alarm. Other alarm actions/forms remain preserved with disabled controls. This is CalDAV alarm metadata, not Matrix delivery. General recurrence interoperability, scoped edits, safe attachment/conference display, and broader alarms remain M5 work.

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

### M6 — Room-owned application principal

ADR014/ADR015 select the configured application principal and operator-managed static bindings. PR #164 has passed the real personal/room/cross-room contract and independent final source review. `target=room` listing can issue an application-principal proof only after current actor membership, power, and exact binding checks; its feature gate defaults disabled. The development contract's synthetic login accounts use a dev-only successful-login burst allowance, leaving production limits unchanged.

Radicale `owner_only` trusts the principal's whole home: gateway bindings enforce cross-room isolation, not backend per-collection ACLs. The configured service home is an operator trust boundary. A Matrix event sender remains authorization/audit identity and never becomes OpenID proof. User-principal room-context routes continue to use the authenticated user's principal.

Authorized room event writes and durable reminder settings/scans/claims/retries are the remaining repository work. PR #187 adds pure canonical event/recurrence/alarm identity validation; it performs no I/O and enables no settings or delivery. Reuse the existing PostgreSQL store and permission helpers. Whole-room reminders use standard `m.mentions.room: true` and current send-time checks. Individual recipients, email consent, and per-user bot proof remain outside the accepted initial scope. Room diagnostics and collection lifecycle remain operator-managed. External etke and production database evidence does not block this repository-side implementation.

### M7 — Data commands

Issue #8 remains open after the help-only PR #105. `upcoming`, `event`, create, and delete/cancel commands depend on the M6 room-owned calendar binding and authorization contracts; do not implement them by treating a room sender as CalDAV identity.

### M8 — Deployment verification

After authentication and runtime configuration are defined, verify the Docker-compatible services on the operator's etke-managed host. In particular, the custom Radicale image override and preservation of the existing `/data` collection store remain unverified and are not implied by the passing owned-image CI contract. The deployment profile still needs host-specific service ownership/lifecycle, playbook or host interface, network and proxy/TLS/public URL, secrets, persistent storage, and PostgreSQL access for reminder state. Build-smoke success and deployment documentation are not deployment evidence. Issue #9 remains open.

### Repository administration

The GitHub branch-protection API confirms that `main` requires pull requests, conversation resolution, the five documented CI checks, and disallows force pushes and deletion; administrator enforcement is enabled. Issue #29 is closed after PR #150 verified the behavior: GitHub reported `mergeable_state=blocked` while four required checks were pending and `clean` after all five passed.

## Highest-priority next steps

1. Keep M4 timezone editing deferred until its CalDAV compatibility boundary is established.
2. Advance M5 through bounded recurrence and round-trip slices, adding DST and named-timezone regressions with each relevant behavior.
3. Build authorized room writes and durable reminders on #164's proven application-principal read boundary. Keep new capabilities gated until their exact-head authorization and real-service contracts pass.
4. Build M7 data commands on those M6 authorization contracts; help is already available.
5. Verify an operator-run deployment on the etke-managed host after the host-specific runtime contract is known.

## Working rules

- Prefer short-lived branches directly from current `main`; avoid stacked PR chains unless a dependency requires them.
- Keep vertical slices small and tested; do not build a generic WebDAV administration framework.
- Keep CalDAV credentials server-side and do not expose them in the widget or logs.
- Treat the Matrix sender as authorization context and audit data, never as proof of OpenID or CalDAV identity.

## Baseline and tracking

- NeoDateFix upstream: `nordeck/matrix-meetings@2d3011f665af04c3cd376c388f7ae3bcb06bba25`
- milestone trackers: #1 (M0), #2 (M1), #3 (M2), #4–#9 (M3–M8)
- M3 implementation slices: #61–#66 — complete
