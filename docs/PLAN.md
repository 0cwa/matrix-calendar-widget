# Implementation plan

This is the executable plan for the initial fork. Agents should keep checkboxes current in the PR that completes a task.

## M0 — Fork hygiene and safe baseline

- [x] Import pinned NeoDateFix baseline with Apache-2.0 attribution.
- [x] Separate project-specific work from the upstream import commit.
- [x] Add repository instructions, target architecture, roadmap, and fork ADRs.
- [x] Rename root/workspace packages, Docker image names, user-facing NeoDateFix strings, and repository URLs.
- [x] Replace remaining inherited Nordeck CI/deployment assumptions; publishing remains intentionally disabled.
- [x] Inventory upstream components as **keep / adapt / delete** in `docs/UPSTREAM_INVENTORY.md`.
- [x] Establish a small fixture library of representative ICS files in `fixtures/ical/`.
- [x] Add pinned Synapse + Matrix-authenticated Radicale services in `dev/`; gateway/widget join in M2.
- [x] Configure `main` branch protection: pull requests required, conversation
      resolution required, the five documented CI checks required, force pushes
      disabled, and branch deletion disabled (confirmed through the GitHub
      branch-protection API on 2026-10-02).
- [x] Verify the configured rules behave as documented with trivial PR #150
      (#29): GitHub reported `mergeable_state=blocked` while required checks
      were pending and `clean` after all five required checks passed.

**Exit:** a contributor can clone the fork, run the inherited tests/build, understand the target architecture, and cannot accidentally publish under Nordeck names.

## M1 — Calendar domain seam

- [x] Define calendar/event/value types independent of FullCalendar, Matrix events, and CalDAV wire types.
- [x] Define `CalendarRepository` and authorization interfaces.
- [x] Add a mock/in-memory repository.
- [x] Route the inherited calendar/list UI through the repository seam.
- [x] Preserve the current calendar UX while replacing meeting terminology in the primary read paths.
- [x] Add timezone/all-day event fixtures and tests.
- [x] Route the primary event create/edit/delete UI through the repository seam (#28/#37; PR #40).

**Exit:** the widget can render and edit mocked calendar events without using NeoDateFix meeting-room persistence.

## M2 — Gateway identity and Radicale discovery

- [x] Add gateway API module to the inherited bot/server deployable.
- [x] Implement widget Matrix OpenID request/exchange.
- [x] Validate Matrix identity server-side.
- [x] Resolve room membership and authorization context.
- [x] Implement CalDAV service discovery and calendar enumeration against Radicale (#44/#49/#55/#56).
- [x] Define the server-side Radicale credential/delegation strategy without handling user Matrix passwords (ADR009 / #54).
- [x] Implement the clean-room Radicale 3.8.0.0 Auth module and pinned project-owned image (ADR024 / #48) for the validated personal actor's tagged, request-scoped OpenID proof. Reject untagged credentials before homeserver I/O; do not include or invoke an external auth package.
- [x] Add the final personal actor OpenID gateway contract against a real Radicale container (#45): same-user enumeration, invalid-identity rejection, and nonmember denial before CalDAV I/O (PR #147). A focused mocked `CalendarGatewayMembershipGuard` test directly verifies a thrown membership lookup and an `isAllowed=false` decision deny before provider/CalDAV I/O.

PR #60's password-authenticated discovery contract is historical evidence about the prior deployment and does not make Matrix-password CalDAV login supported in the owned pre-alpha image. PR #146 completed issue #48's ADR024-scoped first-party adapter, owned image, tests, and dev/contract integration; PR #147 completed #45's real-container same-user enumeration, invalid-identity rejection, and nonmember denial before CalDAV I/O. The focused mocked `CalendarGatewayMembershipGuard` test directly verifies that a thrown membership lookup and an `isAllowed=false` decision stop before provider/CalDAV I/O. M2 is complete against the pinned development Synapse and project-owned Radicale image. The actual etke-host image override and preservation of its existing `/data` volume remain unverified deployment gates.

**Exit:** the gateway can authenticate personal access with the validated actor's tagged Matrix OpenID proof, enumerate only that actor's calendars, and deny invalid identities and non-members before CalDAV I/O. The real-container contract covers those identity and membership cases; the focused mocked guard test directly covers a thrown membership lookup and an `isAllowed=false` denial before provider/CalDAV I/O. The owned backend rejects untagged Matrix-password credentials; support for any separate Radicale-native credential mode requires a future ADR.

## M3 — VEVENT CRUD vertical slice

- [x] Fetch events by visible range.
- [x] Render real Radicale events in month/week/day/list views.
- [x] Create basic VEVENTs.
- [x] Edit basic VEVENTs.
- [x] Delete/cancel events with an explicit confirmation flow.
- [x] Support title, description, start/end, all-day, timezone, location, URL, status, transparency, categories, priority.
- [x] Preserve unknown iCalendar properties on edit.
- [x] Implement ETag conflict handling and user-visible conflict recovery.
- [x] Verify two-client round-trip preservation and stale-ETag behavior against real Radicale (#66 / PR #90).

**Exit:** two independent CalDAV clients can observe each other's basic event changes without destructive round-trip loss.

## M4 — Calendar management

- [x] Lightweight calendar list/visibility controls (#95 / PR #96).
- [x] Create VEVENT-only calendar (#92 / PR #94).
- [x] Rename calendar (#98 / PR #99).
- [x] Update the calendar description through the user-scoped gateway.
- [x] Update calendar color.
- [ ] Update calendar timezone.
- [x] Implement safe VEVENT-only calendar deletion (M4.4; issue #100 closed, PR #101 merged in `6faa1d1`).
- [x] Detect mixed collections and expose an advanced compatibility notice.
- [x] Hide VJOURNAL-only collections.
- [x] Leave VTODO-only collections untouched and hidden from the main calendar UI.
- [x] Add manager-only CalDAV URL/copy diagnostics (#5; ADR022; PR #113).

Calendar creation (#94), lightweight visibility controls (#96), rename (#99), and safe deletion of explicitly writable VEVENT-only calendars (#100 / PR #101) are merged. Issue #100 is closed; the M4.4 deletion slice merged in `6faa1d1fdc773aa50798f3678ef77ae61a786144`. Description is implemented through its own operation; continue to avoid a generic metadata patch framework, and keep color and timezone as separate work.

The description and color slices use dedicated CalDAV gateway operations; keep timezone editing as separate work.

When a collection explicitly reports a supported-component set without
VEVENT, CalDAV discovery keeps it out of the main calendar list. Regression
coverage verifies both VJOURNAL-only and VTODO-only collections stay untouched
and hidden; mixed collections that support VEVENT remain available.

CalDAV URL diagnostics require validated widget identity, joined-room
membership, and manager power before Radicale discovery. The gateway returns
only safe in-base collection names and URLs; the widget displays URLs as plain
text and offers an explicit copy action.

Calendar color uses Apple's `http://apple.com/ns/ical/` `calendar-color` vendor extension. The hosted set/read/clear contract passed against pinned Radicale 3.8.0.0, confirming compatibility with that release only; it does not establish universal CalDAV support or support by other servers. Timezone editing remains separate and unchecked.

**Exit:** normal users no longer need Radicale's web UI to manage team event calendars.

## M5 — Recurrence and iCalendar completeness

- [x] Preserve master floating DATE-TIME endpoints through codec parsing and
      round trips, editor, viewer-local display, and in-memory range filtering
      (ADR023; PR #120).
- [x] Bundle generated IANA 2026d VTIMEZONE data with pinned provenance and
      lookup regressions (PR #121).
- [x] Widen CalDAV candidate REPORT bounds by 32 hours on each side, then clip
      to the exact requested viewer-local half-open interval in the
      authenticated gateway using the explicit viewer timezone. Keep defensive
      widget clipping. The pinned Radicale 3.8.0.0 ignores `CALDAV:timezone`;
      do not send that unsupported query child or claim custom VTIMEZONE
      offsets.
- [x] Add bounded, read-only RRULE/RDATE/EXDATE and detached timing/status
      override projection before both list and grid rendering. Keep occurrence
      view IDs distinct and show the selected occurrence's timing while
      retaining source resource identity for series-level reads and mutations;
      leave malformed/unsupported data opaque with diagnostics and keep
      `RANGE=THISANDFUTURE` hidden.
- [x] Create and edit simple whole-series RRULEs with DAILY, WEEKLY, MONTHLY,
      or YEARLY frequency, positive interval, and never/count/date end controls
      (PR #130).
- [x] Add weekly BYDAY creation/editing and projection for unique plain
      weekday tokens when DTSTART's weekday is included, INTERVAL is omitted
      or a positive safe integer, and the end is never, a positive COUNT, or a
      compatible inclusive UNTIL. WKST is omitted or MO; additional rule parts,
      ordinals, and duplicate parts remain opaque and preserved.
  - [x] Extend the same plain weekday subset beyond INTERVAL=2 to bounded
        interval/count/typed-UNTIL controls, with DST and count-order coverage.
- [x] Edit start/end timing for one supported selected occurrence using its
      original typed RECURRENCE-ID and one ETag-protected resource update.
      Preserve master and sibling metadata; reject ambiguous recurrence and
      any same-event VALARM. The editor requires an explicit instance/series
      choice and displays preflight or conflict feedback (ADR029).
- [ ] Extend RRULE editing to additional recurrence rule parts and patterns.
- [x] Skip and restore one projected supported occurrence by adding or
      removing only its matching EXDATE. Use the original recurrence identity
      even when a detached override moves the displayed instance, and preserve
      the DATE/floating/UTC/TZID value kind and local wall time.
- [ ] General RDATE / EXDATE editing.
  - [x] Add or remove one point-valued RDATE on a supported recurring event.
        Preserve DATE vs DATE-TIME, floating/UTC/TZID form and local wall time;
        require a source VTIMEZONE for new TZID values and keep EXDATE
        precedence unchanged.
  - [x] Remove one selected existing PERIOD-valued RDATE by its exact start
        and explicit end or RFC duration; preserve all point/period siblings,
        parameters, timezone definitions, detached members, and ETag checks.
  - [x] Add one explicit-end or positive-duration PERIOD-valued RDATE to a
        supported timed recurring master in the calendar domain, codec, and
        in-memory adapter without changing DTSTART. Preserve the PERIOD start's
        floating, UTC, or named-TZID identity and exact local value; require a
        source VTIMEZONE for a TZID start. Duration writes require a positive
        RFC duration with supported integer components, reject zero, negative,
        fractional, malformed, unknown, or mixed week-and-time components, and
        make an exact repeated addition of the same PERIOD a no-op. Preserve
        point/period siblings, parameters, timezone definitions, detached
        members, and ETag checks.
  - [x] Add a timed recurring PERIOD from the selected date/time with a
        positive duration in whole weeks or days/time units, preserving the
        source DATE-TIME form and the point-date entry flow.
  - [x] Edit one exact existing PERIOD RDATE start and explicit end or positive
        duration atomically, preserving its representation and endpoint type/
        timezone. Reject stale, duplicate, malformed, or colliding values;
        preserve siblings and exact-source supported no-ops.
- [ ] Broader RECURRENCE-ID instance property editing beyond timing.
- [x] Offer occurrence, this-and-following, and entire-series edit scopes for
      supported timing operations. ADR034 bounds following edits to one
      resource and a supported COUNT series of at most 128 members, with no
      alarms or RDATE/EXDATE data. Preserve original typed identities and
      source master bytes; reject unsafe status, DST ambiguity, arbitrary
      detached suffixes, and oversized results. Broader property/rule splitting
      remains unsupported.
- [ ] DST and named-timezone regression suite.
  - [x] Verify daily `Europe/Stockholm` recurrence viewed in
        `America/Los_Angeles` across the 2026-03-29 spring transition, including
        adjacent viewer-local half-open day windows, preserved 09:00 source
        wall time, and the expected 08:00Z-to-07:00Z instant shift.
  - [x] Verify multi-day all-day DATE recurrence across adjacent
        `Europe/Stockholm` viewer-local half-open day windows around the
        2026-10-25 DST transition (PR #167).
- [x] Preserve existing VALARM data on ordinary event edits and add/edit/remove
      one supported relative DISPLAY alarm whose negative DURATION trigger is
      measured from DTSTART.
- [x] Preserve revision metadata and update supported master edits with one
      whole-second UTC clock snapshot and a bounded SEQUENCE increment (ADR025).
      Malformed, duplicate, and exhausted revision metadata stays opaque;
      no-op edits retain their original metadata.
- [x] Preserve existing organizer and attendee properties on ordinary event
      edits, with rich-fixture round-trip coverage. Attendee authoring remains
      outside the supported editor.
- [ ] Attachments/conference properties where safely interoperable.
  - [x] Preserve opaque attachment and conference properties on ordinary edits;
        authoring remains open.
  - [x] Display bounded, revalidated HTTP(S) URL, URI ATTACH, and CONFERENCE
        links as explicit safe anchors, with no previews, uploads, or fetches
        (ADR031).

The recurring-resource contract uses the hosted CI stack pinned to Synapse
v1.161.0 and the project-owned Radicale 3.8.0.0 OpenID-only image. A passing
result validates this stack only; the broader issue #6 criteria and M5 exit
remain open.

PR #130 completes the first write slice: recurrence controls are limited to
four frequencies, interval, and an optional count or inclusive end date.
Writes replace or clear only the master RRULE and use the existing source
resource ID and ETag. Resources with RDATE, EXDATE, detached instances, multiple
master RRULEs, unsupported RRULE parts, or unsupported timezone rules remain
readable; whole-series RRULE controls stay disabled for complex recurrence
data, and ordinary field edits preserve the complete source resource. The point
RDATE operation below is a separate bounded edit path.

The point RDATE slice adds or removes one DATE or DATE-TIME value on a supported
recurring master. DATE and DATE-TIME must match DTSTART's value type; DATE-TIME
values keep their own floating, UTC, or TZID form and wall time, and their TZID
does not have to match DTSTART's, but a new TZID value requires a matching
VTIMEZONE already present in the source VCALENDAR. Each new value uses a
separate homogeneous RDATE property. Exact duplicates already supplied by
DTSTART, RRULE, or RDATE are no-ops; EXDATE values remain untouched and
authoritative. Point removal compares the full typed identity, including TZID.
A separate remove-only PERIOD operation matches the full start plus explicit
end or original RFC duration. Add operations support one explicit-end or
positive-duration PERIOD RDATE on a supported timed recurring master through
the calendar domain, codec, and in-memory adapter, without changing DTSTART.
The PERIOD start retains its floating, UTC, or named-TZID identity and exact
local value; a TZID start requires its VTIMEZONE in the source VCALENDAR.
Duration writes require positive RFC duration components represented by
supported integers; zero, negative, fractional, malformed, unknown, and mixed
week-and-time values are rejected. An exact repeated addition of the same
PERIOD is a no-op. Point/period siblings, parameters, timezone definitions,
detached members, and ETag conditional updates remain preserved. The widget can
add a positive duration PERIOD from the selected start of a timed recurring
master, preserving its floating, UTC, or named-TZID form. An existing PERIOD can
be edited by matching the complete saved source value and replacing it in
place. Its explicit-end or duration representation and endpoint type/timezone
remain fixed. Sibling collisions, stale or duplicate sources, and unsupported
data fail closed; a supported exact no-op preserves the original resource and
revision metadata. General EXDATE editing, arbitrary RRULEs, and broad M5
completion also remain open.

The bounded weekly BYDAY slice accepts unique plain weekday tokens including
DTSTART's weekday, a positive safe integer interval, and never/count/compatible
inclusive UNTIL ends. COUNT counts occurrences across the selected weekday set,
not weeks. DATE and floating UNTIL keep their value kind; UTC and named-TZID
anchors require UTC UNTIL. Additional rule parts and ordinal weekdays remain
opaque; unrelated event edits preserve their original RRULE and resource data.
Full recurrence editing and client interoperability remain open.

The widget can add, edit, or remove one `ACTION:DISPLAY` VALARM with a single
negative relative DURATION trigger from DTSTART. It preserves the existing
alarm description and unknown alarm properties when changing the trigger.
Multiple alarms, other actions, absolute or non-START triggers, and repeating
alarms remain opaque: only alarm controls are disabled, while ordinary event
fields stay editable and preserve the resource. This edits CalDAV alarm
metadata for clients that honor it; room reminder settings are stored in
gateway sidecar state, separate from iCalendar, and scheduling/delivery use
their own authorization and default-off runtime gates under ADR007.

The CalDAV codec exposes a read-only domain view of master RRULE, RDATE
(including PERIOD values), and EXDATE values plus same-resource, same-UID
detached instances with their original RECURRENCE-ID, explicit DTEND or
preserved RFC DURATION components, and status. Recurrence DATE-TIME values
retain their DATE, named-TZID, UTC, or floating kind and exact local wall time;
PR #120 implements master floating DTSTART and DTEND as independent endpoint
tags, preserving local wall time without TZID or UTC conversion. The widget
projects bounded read-only occurrences from the typed model, applies detached
timing/status overrides, and clips the result before rendering either view.
The widget displays timed events in the viewer's local timezone:
floating times are interpreted there, while named-TZID and UTC times keep their
instant and are converted from their saved zone. This covers details, lists,
visible and accessible calendar-cell labels, grid sorting, and the in-memory
range filter. Projection occurrence IDs keep selected detail timing and
recurrence identity separate from their source resource. Ordinary edit and
delete actions remain series-level; skip/restore changes only the matching
EXDATE for one projected occurrence. A moved override is identified by its
original RECURRENCE-ID. Unsupported or malformed recurrence is hidden with a
diagnostic. The bounded projector resolves source and viewer
IANA timezones only when their exact identifiers exist in the bundled 2026d
VTIMEZONE data. Any embedded definition used by the master or a same-UID
override must match the bundle's ordered STANDARD/DAYLIGHT transition rules,
DTSTART, exact-second offsets, RRULE, and RDATE; known non-transition metadata
is ignored. Missing definitions retain the project's bundled-ID fallback.
Unknown, duplicate, malformed, divergent, or unprovable definitions stay
opaque before projection and contribute count-and-reason diagnostics only,
with no event details or ETags. The original resource remains available for
round-trip preservation, and timing edits are rejected while timezone rules
are unsupported. The editor preserves each endpoint's local value and kind on timing edits;
non-timing edits preserve the original resource, and floating timing edits
serialize without TZID or a UTC marker.

The CalDAV client widens UTC candidate REPORT bounds by 32 hours on both sides
because pinned Radicale 3.8.0.0 ignores `CALDAV:timezone`; it does not send that
unsupported query child. The authenticated gateway receives the explicit
viewer IANA timezone, projects the candidate resources against the requested
half-open interval, and returns full event details and ETags only for supported
intersecting resources. Opaque resources contribute count-and-reason
diagnostics without event details or ETags. The widget keeps defensive
viewer-local clipping before list or grid display. The bound is for supported
IANA 2026d zones and does not establish support for custom VTIMEZONE offsets.
The hosted contract checks floating/DATE boundary retrieval and unchanged
resource ETags/bodies across the read-only query. Collection
`Calendar.timezone` editing remains deferred under M4; projection does not read
or write collection timezone metadata.

PR #121 adds the `@matrix-calendar-widget/ical-timezones` lookup package from
IANA Time Zone Database 2026d. See
[`docs/timezones-ical-data.md`](timezones-ical-data.md) and
`packages/ical-timezones/src/data/provenance.json` for the source checksum and
generator inputs. Package tests verify the committed data hash and selected
historical and current offsets. Projector conversion uses pinned `ical.js`
recurrence expansion reconciled with the bundle's source observances, preserving
historical timezone offset seconds (for example, Asia/Kolkata local noon in
1855 is `06:06:40Z`). This scope does not cover arbitrary embedded custom
VTIMEZONE definitions or establish mainstream-client recurrence
interoperability.
Ordinary master-field patches preserve all VEVENT components, VTIMEZONE, and
unknown properties. Occurrence skip/restore uses an add/remove-one EXDATE patch
and preserves other EXDATEs, RDATE PERIOD values, detached VEVENTs, VALARMs,
and unknown properties. Point RDATE writes likewise preserve sibling values and
all unrelated resource data; new TZID RDATE values are accepted only when the
source VCALENDAR already has their VTIMEZONE definition, and writes do not edit
or clear EXDATE. EXDATE values
keep the projected identity's DATE,
floating, UTC, or named-TZID form and local wall time. `RANGE=THISANDFUTURE`,
malformed, and otherwise unsupported recurrence remains read-only. The codec
continues to reject master events without DTEND. Simple whole-series RRULE
create/edit is implemented; general exception editing and mainstream-client
interoperability remain open.

The generated IANA 2026d VTIMEZONE lookup package is available for downstream
timezone-aware consumers. Its presence alone does not complete the named-zone
DST regression or recurrence-editing criteria above.

**Exit:** common recurring calendars round-trip with mainstream CalDAV clients.

## M6 — Matrix team features and reminders

- [x] Resolve server-only static room/calendar bindings under ADR014/ADR015.
      Validate the current actor, joined membership, action power, and exact
      binding before application-principal proof or CalDAV I/O.
- [x] Prove gated application-principal reads, subject binding, and cross-room
      isolation against pinned Synapse and project-owned Radicale (PR #164).
- [x] Implement separately gated room event get/create/update/delete with
      conditional ETag writes and canonical-content preservation. Hosted
      personal, room-write, nonmember, and cross-room contracts pass (PR #193).
- [x] Route the primary widget through personal and configured room calendars.
      Capabilities are presentation hints; every backend operation rechecks
      authorization. Collection lifecycle and bindings remain operator-managed.
- [x] Store bounded per-alarm room-mention intent as Matrix sidecar metadata.
      Settings and alarm-options APIs require current actor/action/binding and
      known unencrypted room state before source/store access (ADR028/ADR033).
  - [x] Give newly created or explicitly edited DISPLAY alarms stable UUID
        UIDs, preserving untouched legacy alarms and existing identities.
        Malformed, duplicate, or resource-colliding UIDs fail closed.
  - [x] Resolve canonical event UID, typed recurrence identity, and alarm UID;
        filter widget options by the current event UID and match the full tuple.
- [x] Integrate app-owned PostgreSQL migrations, configuration, claims, leases,
      retries, and completion state. PR #199's restricted-role PostgreSQL 16
      job passed all seven cases, including 20 concurrent first-claim pairs.
- [x] Default optional database connections to verified TLS; plaintext requires
      explicit `trusted-private-network` mode (ADR021).
- [x] Wire a bounded scheduler and native Matrix transport behind the separate
      default-off delivery gate. Recheck current binding, settings, canonical
      source, sender membership, message power, room-mention threshold, and
      encryption state. Use standard `m.mentions.room: true`; encrypted or
      unknown scheduled destinations fail closed.
  - [x] Bound paging, candidates, scan windows, and post-claim work; propagate
        cancellation, yield between projection chunks, fence claims, and reserve
        lease-release time. External cancellation remains cooperative.
  - [x] Prove canonical due delivery, repeated stable-transaction deduplication,
        encrypted-room denial, and binding changes before and during scans
        against pinned Synapse/Radicale (PR #199). This proves the pinned stack,
        rather than exactly-once delivery on arbitrary homeservers.
- [x] Offer a safe current-room link from authorized room event details and
      display existing safe conference links. RTC creation and link authoring
      remain future work.
- [x] Add separately gated, best-effort action notices after successful room
      create/update/delete operations (ADR032). The SDK request is awaited and
      retains its timeout behavior; notice failure does not roll back CalDAV.
- [ ] Accept operator enablement against the actual etke image, existing
      `/data`, public ingress/URLs/TLS/secrets, production PostgreSQL endpoint
      and trusted CA, and an isolated restore rehearsal.
- [ ] Room-target diagnostics beyond the supported calendar/event paths.

Room access, event writes, reminder configuration, reminder delivery, and
action notices all default off. An explicitly configured reminder database can
connect and migrate even with delivery disabled; default startup without a
database or enabled flags does no reminder Matrix/CalDAV/timer work. One
replica remains the supported initial topology.

Room-wide reminders are the accepted v1 recipient flow. Individual Matrix
recipients require a later scope decision; email attendee registration remains
deferred until members explicitly verify and consent to sharing an address.
Do not infer addresses from Matrix membership.

**Exit:** repository v1 supports configured room event management and durable
room-wide reminders. Actual Matrix-client and operator deployment acceptance
remain separate; collection lifecycle and bindings stay operator-managed.

## M7 — Non-widget fallback

- [x] `!calendar help`
- [x] `!calendar upcoming`
- [x] `!calendar event <id>`
- [x] constrained event creation command
- [x] constrained delete/cancel command
- [x] normal Matrix fallback messages for important widget-created calendar actions
- [x] help text directing capable clients to the widget

Command syntax, limits, permission gates, plaintext reply handling, and the
separate hosted real-stack acceptance contract are documented in
`docs/bot-calendar.md`. The contract invokes the command service with isolated
Synapse/Radicale adapters; actual client command entry remains untested. Room
access and event writes stay disabled by default.

**Exit:** users on non-widget clients can inspect and perform essential calendar actions without duplicating the entire UI.

## M8 — Hardening and release

- [x] Wire a separate Chromium calendar-component fixture at 320, 390, 768, and
      1280 CSS pixels, with measured overflow, keyboard focus, and axe checks.
      Hosted passing evidence is required; actual Matrix clients remain a
      separate release gate (docs/browser-calendar-validation.md).

- [ ] Responsive/a11y pass across narrow Element panels and full-screen widget.
  - [x] Add current calendar grid/list/details keyboard, focus, accessible-name,
        and axe regressions. Hosted browser fixture checks pass; actual client
        embedding remains unverified; see `docs/calendar-client-validation.md`.
  - [x] Extend the synthetic Chromium fixture to room member/manager controls,
        current-room links, and reminder setting reloads at 320 CSS pixels
        (PR #213; ten hosted cases passed, including transition-settled axe).
- [x] Source-based threat model and independent security review of its current
      boundary claims. Residual risks and deployment acceptance gates remain
      tracked in `docs/threat-model.md`; this is not a penetration test.
- [x] Confine discovered CalDAV principal/home/collection hrefs and refuse
      discovery PROPFIND redirects before credential-bearing follow-up I/O.
  - [x] Apply confinement and redirect refusal to collection mutations, bound
        discovery/property XML bodies to 16 MiB before parsing, and reject
        document type declarations. Preserve ordinary XML entity round trips.
  - [x] Reject redirects for event REPORT/GET/PUT/DELETE and stream-bound
        REPORT/GET response bytes with a configurable 16 MiB default (maximum
        64 MiB), mapping failures to fixed upstream errors.
- [x] Process-local rate and concurrency bounds for calendar gateway and bot
      traffic; distributed and deployment ingress controls remain operator work.
  - [x] Bound calendar-gateway requests by socket peer before Matrix identity
        validation, with capped process-local state and generic retry feedback.
        Shared-proxy, restart, and replica limitations remain explicit.
  - [x] Make the existing 100kb JSON/urlencoded ingress limit explicit and
        verify oversized bodies stop before identity validation.
  - [x] Bound all `!calendar` text, including help and malformed prefixes,
        before Matrix state, proof, CalDAV, or reply work. Cap accepted-window
        traffic, global/room/actor concurrency, and retained identity pairs;
        drop denials silently and retain slots through reply completion.
        Restart and replica limitations remain explicit in `docs/bot-calendar.md`.
- [x] Define the free/busy disclosure and authorization policy in ADR027.
      Availability endpoints, sharing, and UI remain unimplemented.
- [x] Add a cold-backup and isolated-restore runbook for the project-owned
      Compose `radicale-data` and `server-data` volumes, with separate external
      PostgreSQL guidance; etke-managed `/data` remains unverified (PR #170).
- [x] Container images and deployment docs use fork-owned names. This covers
      repository-owned image builds and documented operator-run deployment
      boundaries, not a live etke-host deployment or recovery validation.
  - [x] Document the current Docker build/runtime contracts and the generic operator-run etke/MDAD compatibility boundary.
  - [x] Add non-publishing CI image-build smoke checks with fork-owned local tags; PR #102 run 36316604092 passed both image build steps at `0da7f3345e603e808231a24cc2ed6d979bea987a` without publishing.
- [x] Document upgrade/migration, schema compatibility, and safe rollback for
      the project-owned stack; live operator rehearsal remains unverified.
- [ ] Compatibility matrix: Element Web/Desktop and other tested clients.
- [ ] Performance testing with large calendars and recurrence.
  - [x] Measure synthetic large-calendar domain projection with a reproducible
        benchmark and exact occurrence-count assertions; browser rendering,
        CalDAV latency, memory peaks, and deployment capacity remain unmeasured.
  - [x] Reuse exact timezone transition instants and local boundaries during
        projection; preserve gap/overlap and historical-second semantics with
        regressions and before/after synthetic measurements. Synchronous large
        calendars still need UI and capacity validation.
- [x] Adopt a pre-alpha release/versioning policy: no live deployment or
      publication is authorized, and breaking changes are allowed. Future
      controlled-beta and public-release gates remain explicit.

**Exit:** documented deployable beta suitable for a controlled organizational pilot.

## Working rule

Do not wait for a milestone to be “fully rewritten” before delivering value. Each milestone should land as small, tested vertical PRs that leave the application runnable.
