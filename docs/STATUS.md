# Project status

_Last updated: 2026-09-26_

This file is the short-lived execution snapshot. `docs/PLAN.md` is the durable milestone plan; GitHub issues contain acceptance criteria.

## Current phase

**M3 is complete. Reviewed M4–M8 slices are assembled on the local integration branch; M5 interoperability and M2/M6 live authorization gates remain active.**

The local review branch assembles M4 calendar management, M5 recurrence work, M6 room-binding/auth preflight and static-target widget UI, M7 `!calendar help`, and M8 free/busy privacy and chart-default preparation. This work is local only; it has not been pushed or merged to GitHub `main`, and it does not close the corresponding issues.

The widget now has a real gateway-backed `CalendarRepository`, preservation-first VEVENT CRUD, visible conflict recovery, and a real two-client Radicale interoperability contract. The remaining M2 blocker is external: the pinned `etkecc/radicale-auth-matrix` plugin still only accepts Matrix passwords, while ADR009 requires short-lived Matrix OpenID delegation from the gateway.

M5 recurrence editing, same-resource instance/following overrides, recurrence-set safety, occurrence presentation, property preservation, and DISPLAY alarm editing/addition/removal are locally implemented. New DISPLAY alarms receive one RFC 9074 VALARM UID, a localized description, and a default trigger 15 minutes before start; adding an alarm is explicit, and new events remain alarm-free by default. Existing UID-less alarms and unsupported alarm actions remain preserved. The remaining M5 gate is an end-to-end recurring-resource create/read/patch against the pinned Radicale 3.8.0.0 harness. The contract test is added, but local execution is blocked: `bash dev/up.sh` exited 1 because `/var/run/docker.sock` is absent, and the approved Podman Compose path rejected the pinned Synapse v1.161.0 image before any service started. Radicale alone cannot authenticate this harness because `radicale-auth-matrix` delegates password checks to Synapse. The test remains unverified against a server and M5 stays open; no image substitution or live service was used.

## Landed

### M1 — Calendar domain seam

Complete on `main`:

- calendar/event domain model and repository seam,
- in-memory repository,
- repository-backed calendar/list/editor UI,
- create/edit/delete mutation hooks and invalidation.

### M2 — Gateway identity and Radicale discovery

Merged in-repo:

- authenticated calendar gateway context,
- Matrix room membership/power-level authorization,
- request-scoped validated Matrix OpenID credentials,
- CalDAV principal/home/calendar discovery,
- ADR009 delegated credential contract,
- OpenID→CalDAV credential provider,
- configured authenticated Radicale discovery endpoint,
- real password-auth Radicale discovery contract.

Still external/blocking:

- #48 — add ADR009-compatible OpenID mode to `radicale-auth-matrix`,
- #45 — final real gateway/OpenID/non-member contract after #48.

### M4 — Calendar management

Landed on `main`:

- VEVENT-only calendar creation through repository → gateway → CalDAV `MKCALENDAR` (#92 / PR #94),
- lightweight local calendar visibility controls with friendly names/colors (#95 / PR #96),
- writable-calendar rename via `DAV:displayname` only (#98 / PR #99),
- small create/rename dialogs that keep request errors visible.

Assembled locally, not merged to GitHub `main`:

- safe VEVENT-only calendar deletion (#100 / PR #101), description/color, compatibility, and diagnostics slices. GitHub PR #101 remains open and conflicting against `main`; its public branch still needs synchronization before merge.

Deferred beyond M4:

- Collection `Calendar.timezone` editing. The recurrence display and DATE/floating expansion policy remains viewer-local; collection timezone properties remain untouched. Reconsider writes only after query/client semantics and collection-property round-trip behavior are verified for the pinned Radicale deployment.

### M3 — VEVENT CRUD

Complete on `main`:

- preservation-first `ical.js` codec (#61 / PR #70),
- visible-range and individual resource transport with ETags,
- conditional create/update/delete and structured conflicts,
- authenticated room-authorized gateway VEVENT CRUD,
- gateway-backed widget `CalendarRepository`,
- visible reload/retry conflict UX,
- real Radicale two-client round-trip and stale-ETag contract (#66 / PR #90),
- consolidated M3.2–M3.5 delivery through PR #89.

## Active

- #48 — external `radicale-auth-matrix` OpenID delegation. No writable `0cwa/radicale-auth-matrix` fork exists and the available GitHub connector cannot create/fork repositories.
- #45 — final delegated gateway/OpenID real-container contract, blocked on #48.
- #100 / PR #101 — GitHub still reports the PR open/conflicting and requires branch synchronization; the reviewed M4 implementation sequence is assembled locally.
- #6 / M5 — the pinned Radicale recurring-resource create/read/patch contract remains unverified until the supported container runtime is available.
- #29 — main-branch protection requires repository-rules administration; this is an external repository-admin action.
- M6 / issue #7 — the gateway authorization/binding preflight and static
  single-target room widget UI are assembled locally, but do not complete #7
  or enable live room-principal CalDAV access. Live access remains blocked on
  #48, #45, and ADR014's trusted-domain isolation gate.
  Reminder intent is whole-room `@room`, independent of event email attendees;
  this selection is decided. The app-owned PostgreSQL reminder-state store and
  atomic delivery-claim adapter are implemented locally under ADR019, with
  unit coverage and a PostgreSQL integration contract. The widget explicitly
  creates and removes DISPLAY alarms; each newly created alarm gets a stable
  RFC 9074 VALARM UID for future sidecar identity. This does not configure
  Matrix recipients or trigger delivery. The authenticated room reminder
  configuration API stores inert intent after room membership, binding, and
  event-write policy checks. It does not prove the event, recurrence instance,
  or VALARM UID exists in CalDAV. Widget controls and wiring, current CalDAV
  existence/UID resolution, scheduling, delivery-time `@room` permission
  rechecks, and Matrix sends remain incomplete. The server chart projects
  `MATRIX_CALENDAR_REMINDER_DATABASE_URL` only from an external Secret when
  reminders are enabled; no database is provisioned by the chart. Do not use
  Synapse's database/schema or `pg-credentials` secret. Email attendee fields,
  verified-address registration, and invitation/response semantics are
  deferred until member addresses can be verified and their owners give
  explicit consent. Matrix member APIs do not expose other members' email
  addresses. Live room delivery remains blocked on #48/#45 and ADR014's
  trusted-domain isolation; scheduling, Matrix delivery, and delivery-time
  `@room` permission checks remain unimplemented. `replicaCount` remains one by default;
  this DB boundary does not authorize general multi-replica server operation.
- M7 / issue #8 — `!calendar help` is implemented locally. Data commands and
  fallback messages remain blocked on #48/#45 and the M6 room authorization
  contract; per-user bot targets remain deferred pending trusted actor proof.
- M8 / issue #9 — the free/busy privacy boundary and chart development defaults
  are documented locally; the remaining controlled-pilot hardening and release
  gates remain open.

## Highest-priority next steps

1. Implement #48 in a writable upstream/forked `radicale-auth-matrix` repository; do not copy GPL/LGPL-family plugin code into this Apache-licensed repository.
2. Land #45's final gateway/OpenID/non-member real-container contract and close M2.
3. In parallel while #48 is blocked, synchronize the public #100 / PR #101 branch with current `main`, then merge the reviewed M4 sequence; its local assembly does not change GitHub state.
4. Keep the M5 pinned Radicale recurring-resource round-trip and M6 live room-principal access gated until their server/runtime and OpenID prerequisites pass. Collection timezone editing remains deferred beyond M4 until query/client semantics and property round-trip behavior are verified.
5. For future reminder implementation, first provision an app-owned PostgreSQL database/role and external Secret under ADR019; retain disabled-by-default chart behavior and the one-replica setting until scheduler, bot-state, and authentication validation passes.

## Working rules

- Prefer short-lived branches directly from current `main`; avoid stacked PR chains unless the dependency truly cannot merge first.
- Do not wait on long CI when independent work exists.
- Keep YAGNI pressure on abstractions: reuse the existing repository, auth, credential, codec, and transport seams.
- Do not add caches, sync engines, generic DAV clients, or recurrence/calendar-management frameworks before a concrete slice needs them.
- Treat protocol details as server-internal; widget users manage Calendars, not DAV collections.

## Baseline and tracking

- NeoDateFix upstream: `nordeck/matrix-meetings@2d3011f665af04c3cd376c388f7ae3bcb06bba25`
- milestone trackers: #1 (M0), #2 (M1), #3 (M2), #4–#9 (M3–M8)
- M3 implementation slices: #61–#66 — complete
