# Project status

_Last updated: 2026-10-21._

_Frozen application candidate: `99d4c9f9f36aa0b0861a13499a7f7cd512c56920` (application tree `97022a9d2351655d2aae0a50a44a14bd81daacc9`), accepted from merged PR #294. Exact-source protected checks, CodeQL, PostgreSQL and both-mode CalDAV contracts, standalone Desktop, and normal-bot plus appservice Web/Desktop acceptance passed. Strict ordinary 0/25-event timings passed in both profiles; two trusted Element-origin opening errors per profile met the existing diagnostic predicate, with causes unknown. The prior refresh failure was not reproduced on this source. Trusted workflow run [38913010664](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38913010664) produced and verified the source-bound three-image archive (artifact SHA-256 `3e71a5edea6b2a021a539f792f6abf7522b331b6620765f7ecff28b1b306a49f`; manifest SHA-256 `d0315e465e33e38f093fe4de2faf0e5eb0f57afc6fec7e0c2aa325a727d9ae49`), whose three application images were subsequently imported and verified against their exact configuration IDs and platform. The run also completed the enabled operator rehearsal success path. That is derived runner-completion evidence; separate per-check runtime values were not captured. Pinned database and helper images, native tools, and a dedicated backup account are prepared; private runtime configuration remains pending. Pilot services remain unstarted. Protected credential staging, final operator recording, live calendar/room canary validation, the first real paired backup, isolated gateway restore, and daily activation remain pending in the private operator phase. See the sanitized [release gate](./RELEASE.md)._

_No live pilot UI or completed target deployment is claimed. Scoped pilot authority is recorded privately; it does not authorize broader rollout or registry publication. Issues #275 and #276 were explicitly re-scoped for bounded source cleanup before the pilot; changes to the frozen application source require fresh exact-source qualification and do not satisfy any operator gate._

See the [dated continuation](handoff/2026-10-06/README.md) and
[exact delivered-slice ledger](handoff/2026-10-06/ledger.json).

## Current phase

**Pre-alpha; private operator readiness is the active phase.** M0–M3 are complete for the supported scope. M4 collection management is implemented within its documented boundary; collection-timezone editing remains deferred. M5 supports bounded recurrence and preservation-first editing; issue #6 remains open for broader recurrence and interoperability. M6 room authorization, event operations, the primary widget workflow, and reminder configuration and delivery are implemented behind independent default-off gates. M7 has bounded bot commands and post-success room-target event notices. On application candidate `99d4c9f` / tree `97022a9`, all five protected checks, browser layout, CodeQL, PostgreSQL, both-mode CalDAV, standalone Desktop, and full normal-bot and appservice Web/Desktop acceptance passed. G6 preservation/cleanup, reminders, restart/restore, and browser-egress checks passed. Strict ordinary zero/25-event timing limits passed in both profiles. Two trusted Element-origin opening errors per profile met the existing diagnostic policy; their causes remain unknown. These results establish isolated application acceptance only. **Pilot readiness and operator deployment remain pending** on private target-phase gates; the source-bound archive and hosted rehearsal evidence are now recorded. Mobile/other clients, pinned/full-width layout certification, collection-timezone editing, and broader recurrence/capacity work remain outside the bounded pilot.

For the owner-approved bounded pilot, the required browser profile is full Element Web/Desktop acceptance in `bot-account` mode with the existing strict 0/25-event ordinary-load limits. Full appservice-mode browser certification remains deferred after beta, although both modes passed on this candidate. Backend, identity/authentication, authorization, and CalDAV contract tests remain mandatory in both modes, and `appservice` remains the default mode. Scoped pilot authority is recorded privately; this is not broader rollout or publication authority.

### Public calendar feeds — new source lane

Issue #382 now includes opt-in public ICS feeds described by
[ADR045](./adrs/adr045-public-calendar-feeds.md). The implementation uses
Radicale's native read-only shares, signed gateway URLs, explicit consent,
current owner/room-manager authorization at publication, VEVENT-only validation
on every public read, and tested token redaction. Focused server suites pass
(63 tests); the Radicale auth suite passes 24 tests, including five
log-redaction cases, and the tracked Radicale 3.8.0 runtime contract passes.
This source is outside the frozen application candidate; hosted checks,
independent review, public-route ingress and access-log configuration, and
protected backup/recovery for the signing key and Radicale `/data` remain open.
No live calendar was published.

User feedback opened a follow-up for room setup discovery across multiple
rooms and clearer command-fallback acceptance. Accepted ADR043 and the current
integration worktree add exact, no-argument `!calendar setup` behind its own
default-off gate, a setup-only Matrix server allowlist, bot membership/power
and encryption preconditions, durable dynamic bindings in a dedicated
app-owned PostgreSQL store, exact CalDAV collection reconciliation, and widget
installation. The same asynchronous registry now serves gateway reads,
commands, event operations, and reminder paths; existing room access, event
write, and reminder gates remain independent. Earlier focused checks passed 16
calendar-surface widget tests and 32 command-service tests for empty-room
guidance and the Matrix proxy-404 path. The binding store, registry, and
configuration suites passed 50 tests before the final setup/consumer
integration. Bounded in-band validation now passes the CalDAV-access tests, the
setup, command, authorization, and configuration suites, and the gateway,
event, and reminder unit suites. The scheduler cancellation test waits for
identity resolution to start before aborting; its focused scheduler rerun
passed. The dedicated PostgreSQL binding contract passed six tests on its
recorded source hashes; it has not been rerun against this integrated source.
The complete local check sequence now passes: formatting, lint, TypeScript,
translations, the 22 calendar suites (372 tests), timezone tests (5 tests),
widget tests (784 passed and 3 todo), and server tests (95 suites and 1,568
tests passed; 7 suites and 40 tests skipped). The workspace build also passes.
At this checkpoint, the isolated PostgreSQL binding contract, hosted CI, real
Synapse/Radicale contracts, independent review, and configured-room Element
acceptance were pending. Subsequent hosted qualification on exact source
`898b9c3387545da5c66468bb8625be8bd26d91b9` passed all five required checks
(Quality, Widget, Server and bot, Container image build smoke, and Analyze
JavaScript/TypeScript), file-backed PostgreSQL bootstrap, the real
Synapse/Radicale contract, the six-test PostgreSQL room-binding integration,
and full normal-bot Element Web/Desktop acceptance. The separate appservice
Element Web run failed in G6 member-B room context: Element stayed in
`SYNCING` without a room heading before the bounded wait ended. Its cause is
unknown; appservice browser certification remains deferred for the controlled
pilot. The local normal-bot contract now drives actual Matrix sync through the
production MatrixServer, CommandController, and CommandService implementations
inside a test Nest microservice against a synthetic Synapse/Radicale fixture.
The bot autojoins an invited room, replies to real `!calendar help` and first
`!calendar setup` events, and refuses setup from a joined member without
calendar-manage power before binding, widget, OpenID, or CalDAV effects. The
repeat-setup assertion calls the service directly; a second command event and
its `already-ready` reply are not covered. The test module supplies constructed
services and does not verify the deployed AppModule provider graph. This is
automated source-contract evidence only; it does not establish Element/browser
behavior, human pilot-room acceptance, a production host, or operator
deployment readiness. The 14-test local contract and focused format/lint checks
pass for this source; hosted checks and human/browser acceptance remain separate
gates.

These changes are outside the frozen application candidate above and require
fresh source qualification.

### Frozen application candidate and operator gate

Application acceptance remains tied to frozen source `99d4c9f9f36aa0b0861a13499a7f7cd512c56920` (application tree `97022a9d2351655d2aae0a50a44a14bd81daacc9`). Fresh exact-source CI, CodeQL, service contracts, standalone Desktop, and full Element Web/Desktop runs passed; the earlier refresh/navigation failure was not reproduced. Later trusted tooling and documentation changes have separate provenance. This establishes application-source acceptance only.

The prior exact-source operator/image rehearsal [38892200863](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38892200863) failed during foreign-resource inventory; its sanitized schema-8 result records cleanup as unverified and leaves the cause unknown. Later trusted workflow run [38913010664](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38913010664) verified the archive and completed the enabled operator rehearsal success path for the frozen source. The historical failure remains unchanged and is not treated as the current result. The three application images have since been imported and verified against their exact configuration IDs and platform. Pinned database and helper images, native tools, and a dedicated backup account are prepared; private runtime configuration remains pending. Pilot services remain unstarted. Protected credential staging, final operator recording, live calendar/room canary validation, the first real paired backup, isolated gateway restore, and daily activation remain pending. Issue #255 is closed after the public candidate evidence ledger was completed; issue #251 remains open. #291 is closed after actual cleanup and normal-bot criteria passed. Issues #275 and #276 were explicitly re-scoped for bounded widget source cleanup before the pilot; issue #277 remains separately gated after the pilot, and #278 follows legacy runtime retirement. Any new candidate requires fresh exact-source qualification. No live pilot UI or completed target deployment is claimed.

PR #247's hosted evidence is tied to source `acc535dfe69001403c67853b2171672e74056f51`, tree `784aaeac9f6cf733ed7f38b50eb46bcc4b77c333`; merge commit `20dd7357d833238ac23d817bd29bdb0a9f6d4761` has that same tree. The [Element run](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38458532436) passed for appservice and normal-bot profiles; the [Real Radicale contract](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38458532535), [CI](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38458532444), [Desktop workflow](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38458532500), [PostgreSQL contract](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38458532435), and [CodeQL](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38458532479) also passed. These runs validate that source tree, not a fresh run of the later merge commit. Independent review cleared the exact source. CodeRabbit reported workflow success while its review was skipped because the PR was draft; this is not a CodeRabbit approval. The two trusted opening errors are diagnostic only under the explicit opening-stage predicate after every startup, authentication, CRUD, Desktop, reminder, restore, and timing gate passes; unknown, widget-origin, or later errors remain failures.

The bounded local Stage B rehearsal now passes on accepted application source `99d4c9f9f36aa0b0861a13499a7f7cd512c56920` using helper commit `61e4cf7b4285b8fbc986d89e8a25337f407a6f89`. The closed receipt records source and fixture binding, API authorization/CRUD, reminder initial and restart behavior, paired-store restore, owned cleanup, and foreign-state preservation as passed. It used a network-enabled synthetic microsandbox guest without a host-directory mount, forwarded host Docker socket, or host credentials; the guest is stopped and the run-owned containers, volumes, networks, and task files were removed. The earlier failed attempt remains recorded as failed with cleanup marked unverified in its receipt; its separately verified cleanup is not attributed to that receipt. This establishes local rehearsal only. The existing production backup and meaningful restore predate the enabled room-setup configuration; deployment files and runtime inputs outside the data volumes were not included. The source backup coordinator now supports explicit, bounded host restore-input capture and verification, but a new meaningful snapshot and isolated restore using the complete allowlist remain pending. The daily timer stays disabled until that coverage gate passes and fresh trusted approval is obtained. Operator readiness also requires target-specific ingress, DNS/TLS/proxy, account-ownership, Matrix Authentication Service (MAS), credential-issuance, and secret facts; encrypted off-server Restic-compatible S3 backup with daily scheduling and up to 30 populated-calendar-day recovery points (missed runs leave gaps), independent recovery-key custody, repository-wide prune authority and I/O budget, a dedicated pilot repository or prefix, and a concrete install/disable/rollback rehearsal. No private server, domain, account, provider, or credential details are recorded here.

The first opt-in hosted Docker rehearsal exposed an endpoint-mode mismatch: the
hosted runner's Docker CLI uses its default endpoint, while the local prebuilt
guard intentionally requires a private non-default Unix socket. The hosted
workflow now has a separate explicit runner-mode contract; a fresh source
candidate must still pass the complete service, API, reminder, paired-restore,
and owned-cleanup rehearsal before operator acceptance is recorded. The
GitHub-hosted job shares its Docker daemon with the workflow: baseline inventory
detects foreign resources but does not isolate or prevent damage to resources
visible to that daemon. The selection environment is a test-mode control, not
an authentication boundary. This source-tooling correction does not establish
application, target-host, or production acceptance.

The next source-bound hosted run reached fixture setup but failed before the
operator checks. Source tracing found that the runner removed the bootstrap
Compose environment file before importing the fixture helper, which validates
that file at module load; the helper later creates its generated server
environment with create-only semantics. The tooling follow-up keeps a separate
private bootstrap file through setup, validates the generated file and Compose
model, and then switches later commands to the generated file. The rehearsal
still requires a fresh full pass, including owned cleanup and foreign-state
verification.

A source review confirmed a gateway middleware-order defect: Nest 11.1.28
applied the default CORS option during application initialization, after the
server had registered its explicit request-body limit, calendar rate-limit, and
Matrix-auth middleware. The gateway now installs the same default CORS policy
before those early-response handlers. A loopback HTTP regression through the
shared production setup verifies Authorization preflight handling before auth
and quota, plus CORS headers on a synthetic authorization rejection, the
existing body-size rejection, and a real rate-limit 429. Authentication, body
limits, and the configured quota for actual calendar API requests remain
unchanged; preflight does not consume that quota. The exact hosted candidate
subsequently passed the normal Element Web/Desktop calendar flows, including
the room calendar list path. These isolated application results do not
establish production-host behavior or operator readiness.

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
PostgreSQL reminder state. The merged PR #229 source passed the bounded hosted
application flows and independent source review. Private operator preflight,
target-specific deployment and backup/restore evidence, and any rollout
decision remain open; application acceptance does not complete beta acceptance
or authorize publication or rollout.

The earlier paired Element Web/Desktop acceptance passed against source
candidate `235e7e446df3efd8784d3468f593f2799602767c` in [hosted run
37857387454](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37857387454).
All 105 Web phases and all 12 Desktop cases passed, including authorization
and CRUD, reminder restart, restore of paired Radicale and PostgreSQL state,
the G6 edit/delete and keyboard paths, browser-egress checks, and final
cleanup. Client denial scenarios returned their expected statuses. The
[production Nest HTTP membership-guard test](https://github.com/0cwa/matrix-calendar-widget/blob/main/matrix-calendar-server/test/CalendarGatewayMembershipGuard.test.ts#L150-L185)
returns 403 for a nonmember before room authorization, credential construction,
or CalDAV fetch; it also covers membership lookup failure and a denied list
authorization decision before credential or fetch. The full hosted CI run
[37857387462](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37857387462)
ran this test. It checks request authorization after test identity context is
prepared; separate hosted auth flows verify identity. The approved
zero-event/25-event ordinary profile passed. Reported timings below are
rounded up to the nearest millisecond: cold
activation took 1.351/1.713 seconds, refresh took 1.762/1.832 seconds, the
five event-detail samples peaked at 0.420 seconds, and decoded API responses
peaked at 0.378 seconds. Each result met the predeclared 2-second activation
and refresh, 0.5-second details, and 1-second API limits. The two captured
Element-origin opening errors had complete, trusted Element-bundle stacks and
met the approved reporting policy; source mapping remained unresolved and no
cause was established. The final cleanup census found no remaining processes
and no test account. The result covers isolated application acceptance; it
does not validate or approve a real operator deployment.

This is source status, not release or deployment approval. The bounded recurrence/timezone projector can omit unsupported or malformed source resources from the visible calendar. It warns for source forms it diagnoses but does not guarantee every unsupported form is detected; the widget does not promise a complete view of every existing VEVENT. The [repository and operator readiness matrix](./repository-readiness.md) separates tested repository behavior from evidence that still requires a real operator or Matrix client.

## Landed on `main`

### M0–M3 — fork, domain seam, identity, and basic events

The repository has the calendar domain and repository seam, widget CRUD, user-scoped Matrix OpenID access, an owned OpenID-only Radicale image, conditional ETag writes, and pinned real-service coverage for personal access and event round trips. These contracts exercise the project-owned test stack; they do not validate a production or etke-managed host.

### M4 — calendar management

Calendar visibility, VEVENT-only creation, rename, safe deletion, description and color operations, and mixed-collection safeguards are implemented. The manager-authorized CalDAV diagnostics endpoint remains available to support tooling; raw deployment-specific collection URLs are not exposed in the widget UI. Existing VTODO/VJOURNAL data is not promoted to a first-class UI and mixed resources are preserved by supported edits. Collection `Calendar.timezone` editing remains deferred; issue #5 remains open for broader collection-management acceptance.

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

ADR044 extends reminder configuration to selected current Matrix members and
all-day `DATE` events while keeping the CalDAV alarm canonical. The source
candidate now includes additive reminder-store migrations, target-specific
authorization and delivery filtering, explicit local all-day schedules, a
unified event-details reminder editor, and restore verification for recipient
and schedule metadata. Focused server suites pass 196 tests; focused widget
tests and widget type-check pass. Browser interaction and real Matrix mention
acceptance remain pending and must use the existing local reminder fixture and
Synapse/Radicale harness.

ADR041 accepts an optional process-wide `bot-account` principal mode for room
CalDAV and reminder providers. Its source implementation and focused unit
coverage are present on this candidate. The existing appservice mode remains
the strict default. Both providers share one immutable identity derived from
the exact Matrix SDK client and `ACCESS_TOKEN`, reject an identity mismatch
before OpenID, CalDAV, or reminder transport requests, and preserve actor,
binding, power, ETag, and default-off requirements. Switching modes selects a
different whole-home Radicale principal; the server does not migrate calendars.
Application-service requirements for unrelated features and action notices
remain in force.

A separate normal-bot Element acceptance job uses the shared fixture runner.
Its setup requires disabled synthetic AS registration and no AS token; offline
tests cover setup, OpenID request shape, and workflow guards. The published PR
#247 head `c6a68e9ec49395a671d6a29e48617979df99de3d` passed every terminal check
except normal-bot acceptance in [run
38452260797](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38452260797).
The Real Radicale contract passed appservice and normal-bot behavior (7/7
cases each), confirming the earlier local Jest resolver fix against the hosted
Synapse/Radicale stack. That fix only reorders Jest's module search roots; it
does not change production authentication or Matrix wire behavior.

The Element acceptance passed 127 appservice Web phases, appservice Desktop
12/12, normal-bot Desktop 12/12, normal-bot Web CRUD, reminders, PostgreSQL
restart, paired restore, and both profiles' numeric zero- and 25-event timing
gates. Appservice G6 preservation and owned cleanup passed. Normal-bot G6
failed its combined preservation gate: the supported neighbor PATCH returned
HTTP 200, the edited title appeared in the refreshed list, and the unsupported
canonical object remained byte-identical, but the fixture's ownership check
rejected the gateway href because it expected the appservice home. The G6
state machine then refused to accept the updated ETag for cleanup; three of
four resources were resolved and one cleanup remained unresolved. Source
commit `794cbc60a3a93e38961db49dfe358831e46f44c5` changes the fixture check to
use the selected authenticated principal's localpart while preserving fixed
origins, exact href equality, strong ETag checks, and fail-closed cleanup.
Focused offline tests, E2E TypeScript, and formatting pass; the follow-up has
not yet had a hosted runtime run. Operator acceptance remains open.

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

PR #196 implements bounded `!calendar upcoming`, `event`, `create`, and `delete`/`cancel` commands. Creation is a single timed event; deletion is whole-series only for a supported VEVENT resource. The Matrix sender is actor context and attribution, never the CalDAV identity. Commands recheck current membership, action power, and exact binding before appservice proof or CalDAV I/O. PR #198 adds a process-local command limiter before state lookups and calendar work. PR #199 adds opt-in best-effort notices after successful room-target widget create/update/delete; Matrix failure cannot roll back the CalDAV change. Notices use a sanitized title and opaque resource ID, suppress automatic mentions, and fail closed for encrypted rooms unless the SDK confirms encryption. SDK requests use their default 60-second timeout; the notice service does not override it or provide an abort adapter. A source-only follow-up tracked in [issue #382](https://github.com/0cwa/matrix-calendar-widget/issues/382) makes upcoming replies title-first with localized dates, explicit timezone labels, and inclusive all-day ranges; canonical resource IDs appear only with `--ids` or in explicit event details. Focused source tests cover formatting, option parsing, and escaped HTML with matching plain text. Issue #8 is complete for the repository fallback scope; the follow-up does not establish actual-client or operator acceptance.

### M8 — gateway and transport controls

The server build preserves the `src/static/images` layout used by compiled
`WidgetClient` and runs a packaged-avatar smoke through the actual compiled
`getMeetingWidgetEventContentAsync` method with a local upload stub. This
source check does not qualify a new exact-source candidate or change any
operator/deployment or publication gate.

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
- **M6:** issue #7 bounded repository criteria are complete. ADR041's optional
  bot-account principal integration is implemented; appservice remains the
  default. The published PR #247 head
  `c6a68e9ec49395a671d6a29e48617979df99de3d` passed the Real Radicale contract
  in appservice and normal-bot modes (7/7 cases each), normal-bot Desktop
  12/12, Web CRUD, reminders, PostgreSQL restart, paired restore, and both
  profiles' zero- and 25-event timing gates in
  [run 38452260797](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38452260797).
  The normal-bot G6 preservation/cleanup phase failed because the fixture
  compared the gateway href against the fixed appservice home instead of the
  selected normal-bot home. Source follow-up
  `794cbc60a3a93e38961db49dfe358831e46f44c5` uses the authenticated selected
  localpart and retains exact-path, origin, ETag, and cleanup checks; it is
  still awaiting hosted runtime verification. Keep room access, event writes,
  settings, delivery, and action notices off until the operator accepts each
  capability and its trust boundary. A passing pinned stack is not an
  operator-host or production proof.
- **M8:** The bounded G6 Element Web interaction path remains covered by merged
  run [37739410969](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37739410969),
  including shared-event edit/delete, unsupported-source preservation,
  keyboard/focus, and standard side-panel layout. The latest hosted candidate,
  PR #229 source `fcab6d754d9dc21a2bed8e686a20f6a8a4c2e378`, passed the bounded
  Element Web/Desktop user-flow and ordinary-load acceptance in [paired run
  37916317363](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37916317363):
  105 Web records, 12 Desktop cases, authorization and CRUD, reminder restart
  and paired Radicale/PostgreSQL restore, G6 interactions, and cleanup.
  Ordinary cold activation, measured refresh, detail, and decoded API
  measurements met their declared limits. Two opening errors were fully
  captured from trusted Element bundles under the approved diagnostic policy;
  their cause is unknown. The production HTTP guard test verifies that policy
  denials stop before CalDAV I/O; hosted Element denial flows verify outsider
  requests receive the expected statuses. OpenID identity validation is covered
  separately. The earlier `235e7e` acceptance and failed runs
  [37745671795](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37745671795),
  [37750848604](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37750848604),
  and the prior paired run
  [37777775640](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37777775640)
  remain historical evidence and are not retroactively reclassified.
  Pinned/full-width Apps-drawer layout remains deferred. Custom 31-day and
  250-event timings are diagnostic only; no complete 250-event timing series
  passed. Mobile/other clients and formal screen-reader certification remain
  deferred. Issue #9 remains open for operator readiness, broad capacity, and
  wider client acceptance. Gateway and bot quotas are process-local; callers
  behind one reverse proxy share the gateway TCP-peer quota, and the beta
  target uses one server replica. PR #243 candidate
  `9e1bea6017279646808fe778aa294a8ad32b578c` passed all five protected checks
  and the path-scoped real-Docker PostgreSQL first-initialization contract.
  That synthetic contract verified restricted app-role behavior, distinct
  file-backed secrets, UID/GID 70 app-secret readability, positive TCP
  readiness, application-owned database writes, and fail-closed startup when
  the app secret is missing. It does not establish the operator's database
  endpoint, TLS, host mounts, backup, or recovery behavior.

  Element Web acceptance failed on that exact candidate in [run
  38261568607](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38261568607),
  during `g6-member-b-room-context`, before fixture seeding or the G6 client
  interaction assertions. The sanitized record showed the expected member
  session, route, and room membership, while sync remained `SYNCING` and the
  room view and heading were absent through the bounded readiness window. The
  record does not establish the cause, and this failure is not classified as a
  flake. Reviewed candidate `2792294fcfcb7014cef3ae88b43dacc80f401227`
  adds bounded renderer enums and booleans to the closed G6 Member B summary;
  follow-up source `deb3eba7126f6912723a7a3f3c33c37a4618ba66` (tree
  `3076da655f1c273af4a38371e7087eea1d3b0916`) passed all five protected checks,
  [Element Web acceptance](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38266006163),
  and the [real-Docker PostgreSQL contract](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38266006168).
  The same tree is on `main` as merge commit
  `be6d81c9193bd12c6bcb48aa16819b73350aafc9`. This pass records acceptance on
  the follow-up source but does not explain the original failure; no fix to its
  underlying cause is claimed. Issue #9 and operator readiness remain open.

- **Historical candidate gate:** application acceptance passed on PR #229 source
  `fcab6d754d9dc21a2bed8e686a20f6a8a4c2e378`, merged to `main` with the same
  tree. [CI](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37916317359),
  [CodeQL](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37916317433),
  [CalDAV](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37916317441),
  [standalone Desktop](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37916317482),
  and [paired Element Web/Desktop](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37916317363)
  workflows passed; independent source reviews cleared the candidate. This
  records isolated application behavior only. Private operator readiness,
  target-specific deployment and recovery validation, and any rollout decision
  remain open. No production host or configuration was inspected.
- **Operator readiness:** a fresh backup and isolated restore must cover the enabled deployment's exact host restore inputs in addition to paired application data; the previous successful restore predates room setup. Only after that coverage gate passes may the daily timer be considered, and its separate trusted approval is still pending. Homeserver/proxy behavior, OpenID query-token log redaction, selected Radicale image/configuration, PostgreSQL endpoint TLS/CA and role, secrets, network exposure, and rollback also remain to be verified. The beta baseline uses the project-owned Radicale image and its own store; replacing an existing service or reusing its `/data` is optional and would require additional image/data-path compatibility and recovery evidence. The Compose sidecar does not migrate another service's data.
- **Release/deployment:** the project remains pre-alpha. Build and contract evidence do not authorize image/chart publication or a live deployment.
- **Historical source-bound image archive:** trusted main workflow run
  [37952560924](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37952560924)
  completed successfully on workflow head
  `0df38a81a0dccfd3e241b3011ec89f5593fd9e1c`, bound to accepted application
  source `fcab6d754d9dc21a2bed8e686a20f6a8a4c2e378` and tree
  `660718db2d23a85ac688b7f194a8a66a2c8e201f`. The schema-v2 manifest records
  the generic `linux/amd64` platform, the server, widget, and project-owned
  Radicale image IDs and Buildx digests, resolved immutable base digests,
  image-tar hashes verified on the runner before upload, and seven fixed
  source-derived notices. The manifest SHA-256 is
  `92231b19984afc13b81a03e5877264fcd86f1a7f0edbda46c5573619710a5660`.
  The recorded workflow SHA-256 is
  `0676dc861a4215f6bdb378b3a3a6e60ecdda4760fec180e0cb6ae779827437f9` and
  validator-helper SHA-256 is
  `28364e957804fee8b85e419d6f75d7a137e750c5f48439e85569315a4d3b855a`;
  these are separate from the accepted source and workflow-head SHAs. The
  hosted build, manifest creation and verification, both artifact uploads,
  public summary, and owned builder cleanup passed. GitHub lists image
  artifact `matrix-calendar-widget-images-37952560924-1` at 644,497,156 bytes
  with artifact-bundle SHA-256
  `sha256:3430df8d51e30e34d6d0be4c8ce7c24da3d56a0549b01add8d6e19db72badf3d`;
  the companion provenance artifact is
  `matrix-calendar-widget-provenance-37952560924-1`. The 2,162-byte provenance
  ZIP was authenticated against its GitHub REST artifact digest
  `sha256:4f0514733ef0e2e388e7bc0057d6a550eba58dbcd6842e795d1d5c940ee3a70e`;
  its schema/source/tree/tooling/recipe/base and seven-notice checks passed.
  Independent artifact review cleared at the trusted GitHub runner boundary.
  The 644,497,156-byte image ZIP was not downloaded locally, so local
  verification of the full ZIP is not claimed. Both artifacts are listed with
  a seven-day expiry of 2026-10-16. Target-specific operator comparison,
  deployment and recovery validation, and private operator readiness remain
  open; see the [M8 image archive task](./PLAN.md#m8--hardening-and-release).

## Documentation note

The [readiness matrix](./repository-readiness.md), [README](../README.md), [client validation](./calendar-client-validation.md), [browser validation](./browser-calendar-validation.md), and [threat model](./threat-model.md) describe the source and evidence boundaries. They distinguish pinned service contracts and synthetic browser evidence from actual client, operator-host, and production acceptance.
