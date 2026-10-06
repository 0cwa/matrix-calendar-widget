# Project status

_Last updated: 2026-10-06._

_Source snapshot: `main` at `d32dceb9bd7d1fbc17078ef986040d1940813142` (PR #214)._

## Current phase

**Pre-alpha.** M0–M3 are complete for the supported scope. M4 collection management is implemented within its documented boundary; collection-timezone editing remains deferred. M5 has bounded selected-occurrence and this-and-following timing edits, but issue #6 remains open for broader recurrence and interoperability. M6 room authorization, event operations, the primary widget room-calendar workflow, reminder configuration and delivery runtime, and persistence are implemented behind independent default-off gates. The bounded repository scope for issue #7 is complete; actual-client and operator acceptance remain open. M7 has bounded bot commands and post-success room-target event notices. M8 has source-level gateway and CalDAV limits plus a hosted synthetic Chromium fixture; actual-client, screen-reader, capacity, and operator acceptance remain open.

This is source status, not release or deployment approval. The [repository and operator readiness matrix](./repository-readiness.md) separates tested repository behavior from evidence that still requires a real operator or Matrix client.

## Landed on `main`

### M0–M3 — fork, domain seam, identity, and basic events

The repository has the calendar domain and repository seam, widget CRUD, user-scoped Matrix OpenID access, an owned OpenID-only Radicale image, conditional ETag writes, and pinned real-service coverage for personal access and event round trips. These contracts exercise the project-owned test stack; they do not validate a production or etke-managed host.

### M4 — calendar management

Calendar visibility, VEVENT-only creation, rename, safe deletion, description and color operations, mixed-collection safeguards, and manager-only CalDAV diagnostics are implemented. Existing VTODO/VJOURNAL data is not promoted to a first-class UI and mixed resources are preserved by supported edits. Collection `Calendar.timezone` editing remains deferred; issue #5 remains open for broader collection-management acceptance.

### M5 — bounded recurrence and iCalendar support

The codec and widget support a documented bounded RRULE/RDATE/EXDATE subset, PERIOD values, supported relative DISPLAY VALARM metadata, revision metadata, bundled-timezone projection, selected-occurrence timing edits, typed EXDATE skip/restore, and bounded safe event links. PR #197 adds selected-occurrence timing and link behavior; its exact merged tree `f532c628a227ad6c97ceeaa557feff58d3139dc6` passed all eight required repository checks. PR #200 adds timing-only this-and-following edits for supported finite COUNT rules of at most 128 members within one resource; its exact tree `9d1ce37f2457bbdeef4835ad26a8b28beac438ee` passed all eight checks. It rejects alarms, RDATE/EXDATE, unsafe detached suffixes, unsupported status/timing, and oversized results. Unsupported data remains opaque where supported edits allow it. Issue #6 remains open for broader recurrence authoring and actual client/server interoperability, including additional RRULE parts, general RECURRENCE-ID property editing, arbitrary rule splitting, attendee/email, individual reminder, and attachment/conference authoring.

### M6 — room calendars and reminders

PR #164 established the gated application-service room-read path; PR #193 added separately gated event mutations, strong conditional validators, and refusal of unsafe mixed-resource deletion. `ROOM_CALENDAR_ACCESS_ENABLED` and `ROOM_CALENDAR_EVENT_WRITES_ENABLED` default to `false`. The application-service principal's Radicale `owner_only` access spans its whole home; exact gateway bindings provide application-level room scoping, not backend per-room ACLs.

PR #199 adds manager-authorized reminder configuration and alarm-options APIs, bounded scheduler lifecycle, the native Matrix reminder transport, post-success notices for room-target widget event create/update/delete, and hosted contracts. Its integrated hosted checks passed at tree `9fdc592e770a98a1012cbacbc293cbda75ee726a`; the live Radicale contract completed setup and all three cases, including binding revalidation, and the restricted-role PostgreSQL contract passed 7/7 tests with 20 concurrent claim pairs.

PR #201 connects the primary widget to the gateway-authorized room calendar. It consumes the current room capability response, shows the authorized bound room calendar and its read/write capabilities, displays a safe link to the current Matrix room in event details, and exposes reminder controls for supported alarms to authorized managers. All eight hosted checks passed at exact source tree `a65811903363397ea0883f4e32a98ace7dfdb9a8`; independent review passed on the same tree, merged as `f49acee71280944ad6ae351111947ff01c00031d`. Issue #7's bounded repository criteria are complete. The complete local check set passed with the server Jest suite rerun serially after the parallel `yarn ci` invocation exited 1 when Jest workers were terminated by SIGKILL; the serial server run, remaining calendar/timezone suites, static checks, and production build passed. The hosted checks ran on Node 22. These checks do not establish actual Element client or operator-host acceptance.

Room access, event writes, reminder settings, reminder delivery, and action notices retain independent default-off gates. Delivery requires the app-owned PostgreSQL store and room-access gate, and is controlled by `ROOM_CALENDAR_REMINDER_DELIVERY_ENABLED`. Reminder configuration uses `MATRIX_CALENDAR_REMINDER_CONFIGURATION_ENABLED`; room-target action notices use `ROOM_CALENDAR_ACTION_MESSAGES_ENABLED`. An explicitly configured database connects and migrates at startup; it does not enable room access, event writes, reminder settings or delivery, or action notices.

The initial reminder target is a standard `m.room.message` with `msgtype: m.text` and `m.mentions.room: true` in an unencrypted room. The native appservice transport refuses encrypted or unknown room state; it does not provide end-to-end encrypted scheduled reminders. Stable transaction IDs and database claims support bounded retries but do not guarantee exactly-once delivery. Scheduler work and PostgreSQL coordination are designed for one server replica. Operator acceptance is separate.

### M7 — bot fallback and room-target action notices

PR #196 implements bounded `!calendar upcoming`, `event`, `create`, and `delete`/`cancel` commands. Creation is a single timed event; deletion is whole-series only for a supported VEVENT resource. The Matrix sender is actor context and attribution, never the CalDAV identity. Commands recheck current membership, action power, and exact binding before appservice proof or CalDAV I/O. PR #198 adds a process-local command limiter before state lookups and calendar work. PR #199 adds opt-in best-effort notices after successful room-target widget create/update/delete; Matrix failure cannot roll back the CalDAV change. Notices use a sanitized title and opaque resource ID, suppress automatic mentions, and fail closed for encrypted rooms unless the SDK confirms encryption. SDK requests use their default 60-second timeout; the notice service does not override it or provide an abort adapter. Issue #8 is complete for the repository fallback scope; this does not establish actual-client or operator acceptance.

### M8 — gateway and transport controls

PR #181 limits `/v1/calendar` before OpenID validation to 120 requests per 60 seconds per TCP peer by default, with at most 10,000 in-memory source entries and a generic 429 with `Retry-After`. It ignores forwarded-address headers and resets on restart. PR #189 bounds event responses (16 MiB default, configurable up to 64 MiB) and refuses redirects; PR #191 bounds discovery XML and confines resource paths. Express JSON and urlencoded request bodies remain capped at 100 KiB.

PR #184 adds a synthetic projection benchmark, not a production latency or capacity guarantee. PR #186 adds keyboard and automated accessibility coverage. PR #195 adds a production-preview Chromium fixture; the hosted job passed all eight list/month cases at four viewport sizes on tested tree `c368aacfb32a5b9b57bcb964cb119bdacd20b243`. This validates the standalone component fixture only. Actual Element Web/Desktop/mobile, screen-reader, and production layout results are not claimed.

PR #213 extends that fixture to room member/manager controls, current-room
links, and saved reminder configuration reloads at 320 CSS pixels. All ten
hosted browser cases passed on source tree
`75169dd3f2cc3db2182026b52dbda58bc57239da`; dialog measurements wait for entry
transitions before axe. This remains deterministic component evidence, not a
live Matrix authorization, persistence, or client result.

## Open scope and acceptance blockers

- **M4:** collection-timezone editing and remaining issue #5 acceptance work.
- **M5:** issue #6 remains open for broader recurrence authoring and actual client/server interoperability. The bounded #197/#200 operations do not provide general RECURRENCE-ID property editing, additional RRULE parts, or arbitrary rule splitting. Attendee/email, individual reminder, arbitrary RRULE, and attachment/conference authoring are not part of the implemented editor.
- **M6:** issue #7 bounded repository criteria are complete. Keep room access, event writes, settings, delivery, and action notices off until the operator accepts each capability and its trust boundary. A passing pinned stack is not an etke-host or production proof.
- **M8:** record actual Element Web/Desktop/mobile and screen-reader evidence separately; issue #9 remains open for beta, capacity, and client/operator acceptance. Gateway and bot quotas are process-local. Callers behind one reverse proxy share the gateway's TCP-peer quota; use one server replica or add a trusted upstream/distributed control.
- **Operator readiness:** production homeserver/proxy behavior, OpenID query-token log redaction, actual Radicale image/configuration and `/data` preservation, PostgreSQL endpoint TLS/CA and role, backups/restores, secrets, network exposure, and rollback remain to be verified. The Compose sidecar creates its own Radicale store and is not a migration of etke data.
- **Release/deployment:** the project remains pre-alpha. Build and contract evidence do not authorize image/chart publication or a live deployment.

## Documentation note

The [readiness matrix](./repository-readiness.md), [README](../README.md), [client validation](./calendar-client-validation.md), [browser validation](./browser-calendar-validation.md), and [threat model](./threat-model.md) describe the source and evidence boundaries. They distinguish pinned service contracts and synthetic browser evidence from actual client, operator-host, and production acceptance.
