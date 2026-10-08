# Project status

_Last updated: 2026-10-08._

_Source baseline: `main` at `094342a1a54f894775f3160d7dce447e56a609fb`._

See the [dated continuation](handoff/2026-10-06/README.md) and
[exact delivered-slice ledger](handoff/2026-10-06/ledger.json).

## Current phase

**Pre-alpha.** M0–M3 are complete for the supported scope. M4 collection management is implemented within its documented boundary; collection-timezone editing remains deferred. M5 has bounded selected-occurrence timing/text and this-and-following timing edits, but issue #6 remains open for broader recurrence and interoperability. M6 room authorization, event operations, the primary widget room-calendar workflow, reminder configuration and delivery runtime, and persistence are implemented behind independent default-off gates. The bounded repository scope for issue #7 is complete; operator acceptance remains open. M7 has bounded bot commands and post-success room-target event notices. M8 has source-level gateway and CalDAV limits, a hosted synthetic Chromium fixture, and a completed bounded Element Web interaction run. Ordinary-load acceptance remains open because completed measurements reported widget-opening errors despite passing recorded latency limits. The paired Desktop user-flow and process-cleanup evidence also remain open. Mobile/other clients, formal screen-reader certification, and broad capacity characterization are outside the bounded beta target.

A source review confirmed a gateway middleware-order defect: Nest 11.1.28
applied the default CORS option during application initialization, after the
server had registered its explicit request-body limit, calendar rate-limit, and
Matrix-auth middleware. The gateway now installs the same default CORS policy
before those early-response handlers. A loopback HTTP regression through the
shared production setup verifies Authorization preflight handling before auth
and quota, plus CORS headers on a synthetic authorization rejection, the
existing body-size rejection, and a real rate-limit 429. Authentication, body
limits, and the configured quota for actual calendar API requests remain
unchanged; preflight does not consume that quota. This local source-level fix
does not establish the HTTP status of an earlier hosted calendar-list failure,
explain that failure, or demonstrate that the calendar-list flow passes. Full
Element Web/Desktop and beta acceptance remain open.

The first hosted Element Web shared-event journey passed before merge on draft
PR #225 candidate `031a17e1b1c1b7d7f68b5293a80b8a2c46c5ccb6` ([run
37569137448](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37569137448)).
The isolated run used configured Element Web 1.12.30, Synapse 1.161.0, and
Radicale 3.8.0.0; it observed Chromium 149.0.7827.55, Node 22.23.3, and a
Linux runner. The blocked browser egress count was zero. The journey verified
shared event create/read/edit, a stale-edit conflict and reload, outsider
team-room denial, and denial for the outsider's own unbound room. This is
pre-merge evidence for that candidate, not evidence from the later `main`
source baseline or complete Web/Desktop, operator, restore, capacity, or beta
acceptance.

The controlled-beta scope and its acceptance contract are documented in
[`beta-scope.md`](./beta-scope.md). Its target is Element Web/Desktop, one
server replica, the project-owned Radicale store, and separate app-owned
PostgreSQL reminder state. Scope definition is not acceptance evidence; it
does not complete M4/M5/M8 or authorize publication or rollout.

This is source status, not release or deployment approval. The bounded recurrence/timezone projector can omit unsupported or malformed source resources from the visible calendar. It warns for source forms it diagnoses but does not guarantee every unsupported form is detected; the widget does not promise a complete view of every existing VEVENT. The [repository and operator readiness matrix](./repository-readiness.md) separates tested repository behavior from evidence that still requires a real operator or Matrix client.

## Landed on `main`

### M0–M3 — fork, domain seam, identity, and basic events

The repository has the calendar domain and repository seam, widget CRUD, user-scoped Matrix OpenID access, an owned OpenID-only Radicale image, conditional ETag writes, and pinned real-service coverage for personal access and event round trips. These contracts exercise the project-owned test stack; they do not validate a production or etke-managed host.

### M4 — calendar management

Calendar visibility, VEVENT-only creation, rename, safe deletion, description and color operations, mixed-collection safeguards, and manager-only CalDAV diagnostics are implemented. Existing VTODO/VJOURNAL data is not promoted to a first-class UI and mixed resources are preserved by supported edits. Collection `Calendar.timezone` editing remains deferred; issue #5 remains open for broader collection-management acceptance.

### M5 — bounded recurrence and iCalendar support

The codec and widget support a documented bounded RRULE/RDATE/EXDATE subset, PERIOD values, supported relative and absolute UTC DISPLAY VALARM metadata, revision metadata, bundled-timezone projection, selected-occurrence timing/text edits, typed EXDATE skip/restore, and bounded safe event links. PR #197 adds selected-occurrence timing and link behavior; its exact merged tree `f532c628a227ad6c97ceeaa557feff58d3139dc6` passed all eight required repository checks. PR #200 adds timing-only this-and-following edits for supported finite COUNT rules of at most 128 members within one resource; its exact tree `9d1ce37f2457bbdeef4835ad26a8b28beac438ee` passed all eight checks. It rejects alarms, RDATE/EXDATE, unsafe detached suffixes, unsupported status/timing, and oversized results. Unsupported data remains opaque where supported edits allow it. Issue #6 remains open for broader recurrence authoring and actual client/server interoperability, including additional RRULE parts, general RECURRENCE-ID property editing, arbitrary rule splitting, attendee/email, individual reminder, attachment forms beyond ADR038, broader alarms, and conference forms beyond ADR036.

PR #215 adds one authored MONTHLY ordinal BYDAY selector (first through fifth
or last weekday), with matching DTSTART and existing interval/count/typed-UNTIL
controls. The stricter authoring parser preserves broader read projections;
monthly ordinals remain outside ADR034 following timing edits. All eight hosted
checks, including the real Radicale and PostgreSQL contracts, passed on exact
tree `f4e38e69ddc1d082aae7a27e10aaef08a55b0417`. ADR035 documents this bounded
extension; arbitrary rule authoring and broader M5 interoperability remain open.

PR #217 (ADR036) adds ordinary master-event authoring of one safe HTTP(S) CONFERENCE
URI with an optional label. Runtime validation applies before external I/O;
normal personal/room authorization and conditional ETag writes remain in use.
Malformed/repeated properties, duplicate masters, and same-UID detached
conference data keep those controls read-only. Supported writes retain opaque
parameters, and ordinary/occurrence/following timing edits preserve raw
conference lines on source components and new timing clones. An unchanged
composite form save retains exact source bytes; an effective edit is retained
even when opaque or exhausted revision metadata cannot be updated. This does
not add attachment authoring, multiple conferences, RTC provisioning, or
instance/following conference operations.

PR #220 (ADR040) adds selected-occurrence title, description, and location
editing through sparse set/inherit operations. Explicit empty description and
location remain distinct from inheritance; an untouched imported empty title
is preserved, while an authored title must be nonblank. Text-only overrides
use validated projected timing and the original typed RECURRENCE-ID; existing
moved timing, master/sibling data, and untouched opaque parameters are retained.
An unchanged save creates no detached component. Parameterized fields that
cannot be safely authored, alarms, and ambiguous recurrence fail closed.
This-and-following remains timing-only; broader instance properties and
client/server interoperability remain open.

PR #219 (ADR038) adds one safe HTTP(S) URI ATTACH operation on an unambiguous
master: add, replace a unique saved URI, or remove it. It preserves raw
parameters, unrelated properties, and exact-source supported no-ops. Duplicate
or colliding identities, more than 16 authorable URI links, ambiguous resources
for the target UID, and detached attachment authoring are refused. Malformed, binary,
and unsafe attachment data remain opaque; a bounded safe projection can
remain visible with a read-only marker. This does not add uploads, downloads,
previews, or attachment fetching.

PR #218 (ADR039) adds one absolute UTC DATE-TIME DISPLAY alarm alongside the
existing negative relative DTSTART trigger. Alarm identity, description,
unknown properties, and supported source-exact no-ops are preserved. Non-UTC,
repeating, malformed, ambiguous, or nested alarm data remain opaque.
Absolute alarms are calendar metadata and cannot be delivered as Matrix room
reminders; relative reminder validation and delivery gates remain unchanged.
Nominal negative day/week duration fixtures cover Stockholm spring and fall
DST transitions.

### M6 — room calendars and reminders

PR #164 established the gated application-service room-read path; PR #193 added separately gated event mutations, strong conditional validators, and refusal of unsafe mixed-resource deletion. `ROOM_CALENDAR_ACCESS_ENABLED` and `ROOM_CALENDAR_EVENT_WRITES_ENABLED` default to `false`. The application-service principal's Radicale `owner_only` access spans its whole home; exact gateway bindings provide application-level room scoping, not backend per-room ACLs.

PR #199 adds manager-authorized reminder configuration and alarm-options APIs, bounded scheduler lifecycle, the native Matrix reminder transport, post-success notices for room-target widget event create/update/delete, and hosted contracts. Its integrated hosted checks passed at tree `9fdc592e770a98a1012cbacbc293cbda75ee726a`; the live Radicale contract completed setup and all three cases, including binding revalidation, and the restricted-role PostgreSQL contract passed 7/7 tests with 20 concurrent claim pairs.

PR #201 connects the primary widget to the gateway-authorized room calendar. It consumes the current room capability response, shows the authorized bound room calendar and its read/write capabilities, displays a safe link to the current Matrix room in event details, and exposes reminder controls for supported alarms to authorized managers. All eight hosted checks passed at exact source tree `a65811903363397ea0883f4e32a98ace7dfdb9a8`; independent review passed on the same tree, merged as `f49acee71280944ad6ae351111947ff01c00031d`. Issue #7's bounded repository criteria are complete. The complete local check set passed with the server Jest suite rerun serially after the parallel `yarn ci` invocation exited 1 when Jest workers were terminated by SIGKILL; the serial server run, remaining calendar/timezone suites, static checks, and production build passed. The hosted checks ran on Node 22. These checks do not establish actual Element client or operator-host acceptance.

Draft PR #227 candidate `a02932dafbbfa9316bee5e8bda1ee15ed1ddbaff` passed its
hosted Element Web acceptance on exact head in [run
37611136645](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37611136645).
Using configured Element Web 1.12.30, Synapse 1.161.0, and Radicale 3.8.0.0,
the run verified shared event create/read/edit, stale-edit 409 and reload,
outsider team-room 403 and unbound-room 404, zero blocked browser egress, and
the real relative DISPLAY alarm and room reminder UI. It delivered a real
`m.mentions.room` message, preserved sent state through a gateway restart, and
restored Radicale plus app-owned PostgreSQL into fresh destinations. The
restored UI read the saved reminders, a due canary was delivered once, and the
previous sent-row key and attempt count remained unchanged. The Radicale root
readiness check observed its expected HTTP 302 without following it. The
always-run cleanup step completed; Compose teardown is best-effort, so
container and volume removal were not independently verified. The [sanitized summary
artifact](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37611136645)
has SHA-256 `22f29e8e2609ea2734feb44d665484d9bf983c5fdf6975c18f39588b8abd21f6`.
This proves the tested completed-send recovery path, not exactly-once delivery,
Desktop behavior, full client accessibility, operator readiness, or beta
capacity.

PR #230 adds the bounded G6 Element Web interaction path. Its exact hosted
Element run [37739410969](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37739410969)
and applicable checks passed before merge in `baae43b6a8390a06f0187a54c9de55ef274cb563`.
The run covers the tested shared-event edit/delete, unsupported-source
preservation, keyboard/focus, and standard side-panel layout. It does not
complete the paired Desktop user flow, process cleanup, ordinary-load
acceptance, operator readiness, or the bounded beta contract.

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

PR #216 adds prepared 1,000-event list/month render measurements at 1280×800.
All twelve hosted browser cases passed at tree
`911027044f96463a06e7d42cd2371ecf333662f7`; the real month overflow-link click
returns all 1,000 unique expected list titles. Five measured samples per view
have list median/max 947.30/1044.50 ms and month median/max
2819.90/2898.70 ms. The month samples include a long task up to 2631 ms, so
this does not establish interactivity or a capacity target. Raw measurements
and provenance are retained in
`docs/evidence/calendar-browser-20261006.json` and explained in
`docs/calendar-performance.md`. The timer covers only fixture mount through
populated DOM plus two frames; combined recurring projection/rendering,
loading, memory, and actual clients remain unmeasured.

## Open scope and acceptance blockers

- **M4:** collection-timezone editing and remaining issue #5 acceptance work.
- **M5:** issue #6 remains open for broader recurrence authoring and actual client/server interoperability. The bounded #197/#200 operations do not provide general RECURRENCE-ID property editing, arbitrary RRULE parts, or arbitrary rule splitting. Attendee/email, individual reminder, arbitrary RRULE, attachment forms beyond ADR038, broader alarms, and conference forms beyond ADR036 are not part of the implemented editor. Unsupported recurrence or timezone sources may be omitted from projection; the widget warns for source forms it diagnoses, while preserving the canonical resource.
- **M6:** issue #7 bounded repository criteria are complete. Keep room access, event writes, settings, delivery, and action notices off until the operator accepts each capability and its trust boundary. A passing pinned stack is not an etke-host or production proof.
- **M8:** the bounded G6 Element Web interaction path is merged on `main`; its exact hosted Element run 37739410969 and applicable checks passed. This covers the tested synthetic shared-event edit/delete, unsupported-source preservation, keyboard/focus, and standard side-panel layout path, not broad client or beta acceptance. PR #232 also fixes stale event Details after save; its focused whole-event and recurrence-identity regression tests passed before merge. Pinned/full-width Apps-drawer layout remains deferred. The approved ordinary-load target is zero and 25 events in the default seven-day List view, with cold activation and same-range refresh ≤2s, required API responses ≤1s, and five 25-event details samples ≤0.5s. Latest exact-candidate ordinary-load run [37750848604](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37750848604) met recorded numeric limits but failed on two Element-origin widget-opening errors. Its v12 classifier reported the closed `element-web` namespace and `relative-path-prefix` rejection; it resolved no source location and establishes no cause. An earlier failed ordinary run is retained at [37745671795](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37745671795). The approved policy permits only future ordinary-profile diagnostics emitted from activation through the first contract-ready default List: one decoded HTTP 200 room response for the exact calendar and range, exact returned and rendered event identities, a visible and enabled Create event control, and two-frame stability. The complete, untruncated stack must have a recognized Element production-bundle first frame and every frame must be a trusted bundle on that same static origin. Widget-opening errors with unknown, widget, mixed, or other origins, malformed or truncated stacks, overflow, or errors after readiness still fail. The mapped namespace does not grant an exception or establish a cause; prior runs remain failures and the two recorded errors remain unverified. All ordinary functional, API, timing, and cleanup checks still have to pass, and this subgate does not establish beta acceptance. Paired Desktop shared-editing/user-flow and process-cleanup evidence remain open after failed runs that retained fail-closed cleanup policy. Custom 31-day and 250-event timings are diagnostic only; no complete 250-event timing series passed. Mobile/other clients and formal screen-reader certification remain deferred. Issue #9 remains open for beta, capacity, and client/operator acceptance. Gateway and bot quotas are process-local. Callers behind one reverse proxy share the gateway's TCP-peer quota; the beta target uses one server replica.
- **Operator readiness:** homeserver/proxy behavior, OpenID query-token log redaction, selected Radicale image/configuration, PostgreSQL endpoint TLS/CA and role, backups/restores, secrets, network exposure, and rollback remain to be verified. The beta baseline uses the project-owned Radicale image and its own store; replacing an existing service or reusing its `/data` is optional and would require additional image/data-path compatibility and recovery evidence. The Compose sidecar does not migrate another service's data.
- **Release/deployment:** the project remains pre-alpha. Build and contract evidence do not authorize image/chart publication or a live deployment.

## Documentation note

The [readiness matrix](./repository-readiness.md), [README](../README.md), [client validation](./calendar-client-validation.md), [browser validation](./browser-calendar-validation.md), and [threat model](./threat-model.md) describe the source and evidence boundaries. They distinguish pinned service contracts and synthetic browser evidence from actual client, operator-host, and production acceptance.
