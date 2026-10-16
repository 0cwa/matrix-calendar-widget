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

PR #60's password-authenticated discovery contract is historical evidence about the prior deployment and does not make Matrix-password CalDAV login supported in the owned pre-alpha image. PR #146 completed issue #48's ADR024-scoped first-party adapter, owned image, tests, and dev/contract integration; PR #147 completed #45's real-container same-user enumeration, invalid-identity rejection, and nonmember denial before CalDAV I/O. The focused mocked `CalendarGatewayMembershipGuard` test directly verifies that a thrown membership lookup and an `isAllowed=false` decision stop before provider/CalDAV I/O. M2 is complete against the pinned development Synapse and project-owned Radicale image. Under [ADR037](./adrs/adr037-independent-radicale-store-for-controlled-beta.md), compatibility with an existing service or store is a separate deployment gate only if an operator selects that reuse; the bounded beta baseline uses the project-owned image and an independent store.

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
  - [x] Author one MONTHLY ordinal BYDAY selector (first through fifth or
        last weekday), with matching DTSTART, interval/count/typed-UNTIL
        controls and DST regressions. Preserve broader read projection and
        keep this-and-following timing support within ADR034 (PR #215, ADR035;
        all eight hosted checks passed).
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
  - [x] Edit selected-occurrence title, description, and location with sparse
        set/inherit operations, preserving explicit empty values and original
        typed recurrence identity. Text-only overrides use validated projected
        timing; unchanged saves do not create a detached component. Preserve
        opaque parameters and sibling data; reject unsupported selected fields,
        alarms, and ambiguous recurrence. Following edits remain timing-only
        (PR #220, ADR040).
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
  - [x] Add, edit, or remove one absolute UTC DATE-TIME DISPLAY trigger
        (ADR039), preserving alarm identity, description, unknown properties,
        and exact-source supported no-ops. Absolute alarms remain calendar
        metadata and are unavailable for Matrix room reminder delivery.
  - [x] Verify nominal negative day/week relative triggers across Stockholm
        spring and fall DST changes; retain wall-time duration semantics.
- [x] Preserve revision metadata and update supported master edits with one
      whole-second UTC clock snapshot and a bounded SEQUENCE increment (ADR025).
      Malformed, duplicate, and exhausted revision metadata stays opaque;
      no-op edits retain their original metadata.
- [x] Preserve existing organizer and attendee properties on ordinary event
      edits, with rich-fixture round-trip coverage. Attendee authoring remains
      outside the supported editor.
- [ ] Attachments/conference properties where safely interoperable.
  - [x] Preserve opaque attachment and conference properties on ordinary edits;
        broader authoring remains open.
  - [x] Display bounded, revalidated HTTP(S) URL, URI ATTACH, and CONFERENCE
        links as explicit safe anchors, with no previews, uploads, or fetches
        (ADR031).
  - [x] Add, label, change, or remove one safe HTTP(S) CONFERENCE URI on an
        unambiguous master through ordinary ETag-protected event editing
        (ADR036). Require explicit VALUE=URI; keep malformed/repeated source
        properties and detached-specific conference data read-only. Preserve
        raw parameters on all source components and timing clones; unchanged
        composite saves retain exact source bytes and revision metadata.
  - [x] Add, change, or remove one safe HTTP(S) URI ATTACH on an unambiguous
        master, using one ETag-protected resource update (ADR038). Preserve raw
        parameters and unrelated source data; reject duplicate or colliding
        identities, over-limit resources, and detached attachment authoring.
        Binary attachments and file upload/download remain outside this slice.

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
negative relative DURATION trigger from DTSTART or one absolute UTC DATE-TIME
trigger (ADR039). It preserves the existing alarm identity, description, and
unknown properties when changing the trigger. Multiple alarms, other actions,
non-UTC absolute or non-START relative triggers, repeating alarms, and nested
alarm components remain opaque: only alarm controls are disabled, while
ordinary event fields stay editable and preserve the resource. This edits CalDAV alarm
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
projects bounded occurrences from the typed model, applies detached timing,
status, and supported text overrides, and clips the result before rendering
either view.
The widget displays timed events in the viewer's local timezone:
floating times are interpreted there, while named-TZID and UTC times keep their
instant and are converted from their saved zone. This covers details, lists,
visible and accessible calendar-cell labels, grid sorting, and the in-memory
range filter. Projection occurrence IDs keep selected detail timing and
recurrence identity separate from their source resource. Delete actions remain series-level. Supported edits offer explicit occurrence,
series, and bounded following scopes; selected-occurrence text edits use
ADR040 while following edits remain timing-only. Skip/restore changes only the
matching EXDATE for one projected occurrence. A moved override is identified by its
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
- [x] Implement the accepted ADR041 opt-in `bot-account` mode for room CalDAV
      and reminder providers. Keep `appservice` as the strict default and
      preserve its contracts. Resolve one shared principal identity from the
      same Matrix SDK client constructed with `ACCESS_TOKEN`, verify
      `AppRuntimeContext.botUserId`, and stop before OpenID, CalDAV, or reminder
      transport requests on identity mismatch or failure. Use that same
      identity for CalDAV expected-principal validation and reminder sender
      checks; ordinary bot-account reminder REST calls omit the
      application-service `user_id` query parameter. Preserve actor, binding,
      power, ETag, default-off, PostgreSQL persistence, and paired restore gates.
      Do not change unrelated application-service features or action notices.
- [x] Add a separate normal-bot Element acceptance job to the shared fixture
      runner. Require disabled synthetic AS registration and no AS token while
      retaining the same authorization, event, reminder, restart, restore, and
      cleanup assertions. Add offline setup, OpenID request-shape, and workflow
      guard tests. The current source candidate also includes Synapse's
      noninteractive synthetic-account registration flag, the required `{}`
      bot-mode OpenID request body, fixture `fetch` forwarding to the subject
      observer, a digest-checked Desktop archive fallback, bounded SDK whoami
      diagnostics, and principal-mode forwarding to the 25-event seed child.
      Focused offline tests cover these changes. The source-bound hosted
      acceptance below now covers the complete normal-bot application path;
      operator acceptance remains open.
      The signed Desktop index offers 1.12.31 and omits pinned 1.12.30; the
      fixture uses the digest-checked pinned archive fallback.
- [x] Complete normal-bot G6 unsupported-resource preservation and owned
      cleanup in hosted acceptance. PR #247 source
      `acc535dfe69001403c67853b2171672e74056f51` passed the [Element run
      38458532436](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38458532436):
      the supported neighbor retained its identity after edit, the unsupported
      canonical object remained byte-identical, all four owned resources were
      accounted for (three deleted, one already absent, none unresolved), and
      both appservice and normal-bot profiles passed. The [Real Radicale
      contract](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38458532535)
      passed 7/7 cases in each mode. Source head
      `acc535dfe69001403c67853b2171672e74056f51` (tree
      `784aaeac9f6cf733ed7f38b50eb46bcc4b77c333`) was merged as
      `20dd7357d833238ac23d817bd29bdb0a9f6d4761` with the same tree. The
      earlier failed run remains linked in its historical workflow record;
      this passing source-bound run closes that blocker.
- [x] Offer a safe current-room link from authorized room event details and
      display existing safe conference links. Ordinary master conference URI
      authoring follows ADR036; RTC service creation remains future work.
- [x] Add separately gated, best-effort action notices after successful room
      create/update/delete operations (ADR032). The SDK request is awaited and
      retains its timeout behavior; notice failure does not roll back CalDAV.
- [ ] Complete the controlled-beta local and operator readiness gates for the
      selected deployment. Full isolated local Stage B has not passed: the
      local probe stopped while verifying container capabilities; the
      inspected value was not retained and guest execution was skipped. Hosted
      source-bound Element and CI acceptance is complete; the separate local
      source-bound server image/cache/runtime rehearsal remains open. Then
      record the actual target's ingress,
      DNS/TLS/proxy, account ownership, MAS, credential issuance, and secret
      facts; validate encrypted off-server Restic-compatible S3 backups with
      daily scheduling and up to 30 populated-calendar-day recovery points;
      missed daily runs leave gaps. Verify independent recovery-key custody,
      paired Radicale plus app-owned PostgreSQL restore, and install/disable/
      rollback. The coordinator's automatic forget/prune path is opt-in and
      requires the configured Restic host and project tag to match the Compose
      project name; target acceptance and recovery evidence remain open.
      The bounded beta baseline uses the project-owned Radicale image and its
      own store. Do not record private server, domain, account, provider, or
      credential details in public docs. Beta readiness and deployment remain
      not ready until these gates and a separate rollout decision are complete.
  - [x] Add reviewed source-only local rehearsal support: [prebuilt/no-pull
        setup](../dev/up.sh), [API probe](../dev/element-acceptance-api-probe.mjs),
        [reminder fixture](../dev/local-reminder-fixture.mjs), and [paired
        restore helper](../dev/element-acceptance-reminder-restore.mjs).
        Focused tooling checks use in-process HTTP, fake commands, and fixed-enum
        formatter cases. The composite action records fixed-enum step outcomes,
        using `unknown` for absent, cancelled, or unrecognized outcomes. It
        reports the first tracked failure only when the report is complete;
        otherwise `first_failed_phase` is `unknown`. A diagnostic write failure
        is marked unavailable without changing acceptance or cleanup outcomes.
        No external service or real API, image store, restart, or restore was exercised;
        this does not pass local Stage B or image/cache/runtime acceptance.
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
room-wide reminders in the default appservice mode and the optional bot-account
mode. Actual Matrix-client and operator deployment acceptance remain separate;
collection lifecycle and bindings stay operator-managed.

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

Issue #255’s sanitized current-candidate evidence index is [docs/RELEASE.md](./RELEASE.md). It binds evidence to an exact source candidate, keeps target-specific operator facts private, and does not grant deployment approval.

### Issue #273 pre-candidate sequence

- [x] Integrate #274, #259, #282, and #272 on frozen application-source
      candidate `b0e620f3f31b9978705a5e58e647c77ba9b67a97` (tree
      `f5af0b07fbfb192cdd6dc90fb61cb13e80777efb`).
- [x] Merge PR #293's issue #291 cleanup retry against the settled Desktop
      process census into `main` at `c380f5ff3d5ccfede2a54100473cc4ea1169fe2b`
      (tree `b79e9cc77db3434ca2707c7d5cc96f0914c41e3f`). This records the
      source change only; it does not qualify a later integrated candidate.
- [x] Identify the fixture-level reminder-restore mismatch from source-bound
      operator run `38798989805`: the restore gateway is configured with
      `restore-radicale:5232`, but the reminder fixture accepted only the
      normal `radicale:5232` and normal-flow loopback origins. Candidate
      `75c65e395987b2c1762c826264a883fe9e85e161` adds flow-specific origin
      validation and matching cleanup candidates, with focused tests for the
      exported restore path, exact marker update, owned cleanup, and wrong-flow
      rejection. This establishes the fixture mismatch and local regression
      behavior only; actual restore-service acceptance remains unverified.
- [x] Run exact-source application acceptance on candidate
      `99d4c9f9f36aa0b0861a13499a7f7cd512c56920` (application tree
      `97022a9d2351655d2aae0a50a44a14bd81daacc`). All five protected checks,
      browser layout, CodeQL, PostgreSQL, both-mode CalDAV, standalone Desktop,
      and normal-bot plus appservice Element Web/Desktop acceptance passed.
      The prior Web refresh failure was not reproduced. Full details and
      performance samples are in [docs/RELEASE.md](./RELEASE.md). This
      completes application-source acceptance only.
- [x] Close issue #291 after the actual settled-census cleanup and normal-bot
      criteria passed on the accepted application source; its merged source
      retry alone was not treated as acceptance.
- [ ] Qualify the three source-bound images and reconcile the manifest/evidence
      index. Exact-source operator/image run
      [38892200863](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38892200863)
      failed during foreign-resource inventory. Its schema-8 summary reports
      cleanup attempted but unverified, ownership false, and
      foreign-state-unchanged false; resource kind, difference, and cause are
      unknown. No accepted three-image manifest/archive exists. The source
      owner is investigating the runner comparison separately; preserving
      application candidate `99d4c9f` under a later trusted workflow source
      remains subject to the existing contract and is not acceptance evidence
      yet. Issues #255 and #251 remain open. No application installation or
      publication has occurred.
- [ ] Keep issues #275–#278 post-pilot. In particular, defer the #275
      StoreProvider/Redux startup retirement until after the pilot.

- [x] Wire a separate Chromium calendar-component fixture at 320, 390, 768, and
      1280 CSS pixels, with measured overflow, keyboard focus, and axe checks.
      Hosted passing evidence is required; actual Matrix clients remain a
      separate release gate (docs/browser-calendar-validation.md).

- [x] Actual Element Web/Desktop responsive and keyboard/focus acceptance for
      the bounded beta target (see `docs/beta-scope.md`). Require the standard
      side-panel widget layout and overflow checks; pinned/full-width Apps-drawer
      layout certification is deferred. Mobile clients and formal screen-reader
      certification are deferred beyond this candidate. Candidate `99d4c9f`
      passed full normal-bot and appservice Web/Desktop acceptance, including
      the standard side panel, G6 preservation and cleanup, reminders,
      restart/restore, and browser-egress checks. Full appservice browser
      certification remains deferred until after beta despite the observed
      pass; backend, identity/authentication, room authorization, and CalDAV
      contracts remain mandatory in both modes. This scope does not authorize
      publication or broader rollout.
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
  - [x] Install the gateway's unchanged default CORS policy before explicit
        body-limit, calendar rate-limit, and Matrix-auth middleware. A loopback
        HTTP regression through the shared production setup verifies an
        Authorization preflight does not invoke auth or consume the test quota,
        and that CORS headers remain on synthetic authorization rejection,
        body-limit 413, and rate-limit 429 responses. The exact hosted candidate
        also passed the normal Element Web/Desktop room-calendar flows; operator
        host behavior remains unverified.
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
      The public runbook now recommends pinned Restic 0.19.1, generic
      S3-compatible storage, operator-managed daily systemd scheduling, and up to
      30 populated-calendar-day recovery points; missed daily runs leave gaps.
      It preserves a coordinated PostgreSQL custom dump and isolated restore
      boundaries. The coordinator does not select a provider or validate a real S3 endpoint, scheduled run, or target-host
      recovery.
  - [x] Add a host-local cold-capture coordinator and generic systemd service
        and timer templates. Focused service tests use fake commands; an
        opt-in local Restic test uses synthetic captures and a new file
        repository. Neither test path exercises S3. The templates
        remain operator-installed and disabled; the coordinator uploads a
        verified paired capture after service restart and never initializes a
        Restic repository. `resticRetentionEnabled` defaults off; when enabled
        it runs the fixed `forget --keep-daily 30 --prune` policy after
        successful upload. The configured repository, host, comma-joined tag
        pair, and `host,tags` grouping scope snapshots eligible for forgetting;
        prune itself scans the repository, preserves data referenced by any
        retained snapshot, and may remove or repack other unreferenced data.
        Automatic prune requires repository-wide maintenance authority and an
        S3 I/O budget; a dedicated pilot repository or prefix is planned.
        `--keep-daily 30` retains points for up to 30 populated calendar days,
        so missed backup days leave gaps. Fake-command tests cover
        the backup-only default, scope validation, command order, failed-upload
        skip, and retention failure reporting. Real S3, scheduling, and
        target-host recovery remain open operator gates. The separate
        `cleanupSuccessfulCapture` option defaults off and may remove only the
        current marked staging directory after bounded snapshot readback and
        local identity checks; keep it disabled until an independent isolated
        restore succeeds. It does not sweep older captures or change remote
        retention.
- [x] Container images and deployment docs use fork-owned names. This covers
      repository-owned image builds and documented operator-run deployment
      boundaries, not a live etke-host deployment or recovery validation.
  - [x] Document the current Docker build/runtime contracts and the generic operator-run etke/MDAD compatibility boundary.
  - [x] Add non-publishing CI image-build smoke checks with fork-owned local tags; PR #102 run 36316604092 passed both image build steps at `0da7f3345e603e808231a24cc2ed6d979bea987a` without publishing.
- [x] Generate and verify a short-lived, source-bound image archive for the
      exact accepted candidate with the trusted `main` workflow. Hosted run
      [37952560924](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37952560924)
      completed successfully on workflow head
      `0df38a81a0dccfd3e241b3011ec89f5593fd9e1c`, bound to accepted source
      `fcab6d754d9dc21a2bed8e686a20f6a8a4c2e378` and tree
      `660718db2d23a85ac688b7f194a8a66a2c8e201f`. Its schema-v2 manifest
      records the generic `linux/amd64` platform, all three image IDs and
      Buildx digests, immutable base digests, archive hashes, and the seven
      fixed source-derived notices. The manifest SHA-256 is
      `92231b19984afc13b81a03e5877264fcd86f1a7f0edbda46c5573619710a5660`.
      The workflow SHA-256 is
      `0676dc861a4215f6bdb378b3a3a6e60ecdda4760fec180e0cb6ae779827437f9`;
      the validator-helper SHA-256 is
      `28364e957804fee8b85e419d6f75d7a137e750c5f48439e85569315a4d3b855a`.
      The image artifact `matrix-calendar-widget-images-37952560924-1` is
      644,497,156 bytes; GitHub reports artifact-bundle SHA-256
      `sha256:3430df8d51e30e34d6d0be4c8ce7c24da3d56a0549b01add8d6e19db72badf3d`.
      The provenance artifact is
      `matrix-calendar-widget-provenance-37952560924-1`. Image and provenance
      uploads, hosted manifest creation/verification, builder cleanup, and the
      public run summary succeeded. The 2,162-byte provenance ZIP matched
      GitHub's REST artifact digest
      `sha256:4f0514733ef0e2e388e7bc0057d6a550eba58dbcd6842e795d1d5c940ee3a70e`;
      its schema, source/tree/tooling, recipe/base, and seven-notice checks
      passed. Independent artifact review cleared at the trusted GitHub runner
      boundary. The 644,497,156-byte full image ZIP was not downloaded locally,
      so no local full-ZIP verification is claimed. These artifacts expire
      2026-10-16. Target-specific operator comparison, deployment, and private
      operator readiness remain separate open gates.
- [x] Document upgrade/migration, schema compatibility, and safe rollback for
      the project-owned stack; live operator rehearsal remains unverified.
- [ ] Record exact Element Web and Desktop versions and results for the beta
      target. Other Matrix clients remain a broader compatibility task.
- [ ] Performance testing with large calendars and recurrence.
  - [x] Measure synthetic large-calendar domain projection with a reproducible
        benchmark and exact occurrence-count assertions; this measures domain
        projection separately from rendering, loading, and memory.
  - [x] Measure prepared 1,000-event list/month rendering at 1280×800 with
        five samples per view, exact counts, overflow checks, and a real month
        overflow-link interaction (PR #216; twelve hosted browser cases pass
        at tree `911027044f96463a06e7d42cd2371ecf333662f7`). Retain raw numeric
        evidence in `docs/evidence/calendar-browser-20261006.json`. Month
        samples include long tasks up to 2.63 seconds; combined recurring
        projection/rendering, memory, CalDAV latency, and capacity remain open.
  - [x] Reuse exact timezone transition instants and local boundaries during
        projection; preserve gap/overlap and historical-second semantics with
        regressions and before/after synthetic measurements. Synchronous large
        calendars still need UI and capacity validation.
- [x] Adopt a pre-alpha release/versioning policy: no live deployment or
      publication is authorized, and breaking changes are allowed. Future
      controlled-beta and public-release gates remain explicit.

### Controlled beta acceptance — separate from milestone completion

- [x] Define the bounded Element Web/Desktop pilot scope, deployment shape,
      and acceptance evidence in `docs/beta-scope.md`.
- [x] Add default-off sidecar Compose inputs, an optional server-only env file,
      and a sanitized no-start preflight for room/appservice/reminder settings
      and external PostgreSQL configuration. CI covers omitted defaults and
      valid/invalid opt-ins; this validates configuration only, not operator or
      production acceptance (PR #224).
- [x] Pass the existing five protected checks on the exact candidate head and
      retain the relevant hosted browser-layout and real Radicale/PostgreSQL
      contract results. All passed on PR #227 candidate
      `a02932dafbbfa9316bee5e8bda1ee15ed1ddbaff`, including hosted run
      [37611136645](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37611136645).
- [x] Run the first hosted Element Web journey against isolated pinned
      Synapse, project-owned Radicale, and gateway services: two authorized
      members share a basic event create/read/edit; the stale editor receives
      a conflict and reloads the saved event; an outsider-room widget targeting
      the team room and the outsider's own unbound room are denied. This slice
      does not test attachment authoring or establish the remaining beta gates.
      Passed on draft PR #225 candidate `031a17e1b1c1b7d7f68b5293a80b8a2c46c5ccb6`
      in [hosted run 37569137448](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37569137448): configured Element Web 1.12.30, Synapse 1.161.0, and Radicale 3.8.0.0; observed Chromium 149.0.7827.55, Node 22.23.3, and Linux runner; blocked browser egress count was zero.
- [x] Complete bounded actual Element Web/Desktop user-flow acceptance
      against isolated pinned Synapse, project-owned Radicale, and PostgreSQL services before
      any production contact. PR #229 source `fcab6d754d9dc21a2bed8e686a20f6a8a4c2e378`
      passed all 105 Web records and all 12 paired Desktop/Web cases in [hosted
      run 37916317363](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37916317363).
      [CI](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37916317359),
      [CodeQL](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37916317433),
      [CalDAV](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37916317441),
      and [standalone Desktop](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37916317482)
      workflows also passed on that exact source. The run covered authorized
      CRUD, outsider denial, reminders
      across restart and paired-store restore, G6 preservation and delete,
      keyboard/focus, and cleanup. Independent source reviews cleared the
      candidate. The Desktop journey child exited 0 and Playwright passed;
      startup success consumed the same passing summary, and native cleanup
      confirmed the test account absent with zero observed UID processes. This
      completes isolated application acceptance only; private operator
      readiness and deployment evidence remain open.
- [x] Verify the actual Element Web shared edit, stale-ETag conflict/reload,
      and outsider denial for the bound team room and own unbound room on PR
      #227 candidate `a02932dafbbfa9316bee5e8bda1ee15ed1ddbaff`, hosted run
      [37611136645](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37611136645).
- [x] Prove unauthorized client requests are denied before CalDAV I/O. The
      production Nest HTTP membership-guard test returns 403 for a nonmember
      before room authorization, credential construction, or CalDAV fetch; it
      also covers membership lookup failure and denied list authorization before
      credential or fetch. The test ran in hosted CI
      [37857387462](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37857387462).
      It exercises authorization after the test identity context is prepared;
      OpenID identity validation is covered separately by hosted auth checks.
      See the [test source](https://github.com/0cwa/matrix-calendar-widget/blob/main/matrix-calendar-server/test/CalendarGatewayMembershipGuard.test.ts#L150-L185).
- [x] Exercise actual Element Web event edit/delete, unsupported-projection
      disclosure with canonical-resource preservation, keyboard/focus, and the
      standard side-panel layout. PR #230 passed exact hosted Element run
      [37739410969](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37739410969)
      and its applicable checks before merge in `baae43b6a8390a06f0187a54c9de55ef274cb563`.
      The exact candidate run above adds paired Web/Desktop acceptance for the
      bounded synthetic flow; it does not establish operator or production
      acceptance.
- [x] Exercise the enabled unencrypted-room reminder path, then restart and
      separately restore both Radicale and application PostgreSQL data in an
      isolated environment. PR #227 candidate
      `a02932dafbbfa9316bee5e8bda1ee15ed1ddbaff` passed the real Element Web
      reminder UI, relative DISPLAY alarm readback, `m.mentions.room` delivery,
      gateway restart scheduler scan, and fresh paired-store restore. The
      restored scheduler delivered its due canary once, prior sent-state stayed
      unchanged, and the always-run cleanup step completed. Compose teardown is
      best-effort, so container and volume removal were not independently
      verified. This covers the completed-send recovery path and does not claim
      exactly-once delivery.
- [ ] Record an operator-approved enrollment/capacity envelope with hardware,
      runtime, date-range event counts, API/render latency, and pre-declared
      pass thresholds. Do not infer a universal supported event count.
  - [x] Predeclare the approved synthetic Element Web ordinary-load target of
        zero and 25 events in the default seven-day List view in the standard
        side-panel WidgetCard path, with cold activation and same-range refresh
        through the visible List date-range picker limited to 2s, API limited to
        1s, and five 25-event details samples limited to 0.5s
        in `docs/calendar-performance.md`. PR #229 source
        `fcab6d754d9dc21a2bed8e686a20f6a8a4c2e378` passed hosted run
        [37916317363](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37916317363):
        values below round up to the nearest millisecond. Cold activation
        peaked at 1.966 seconds, measured same-range refresh at 1.797 seconds,
        five detail samples at 0.427 seconds, and 42 required decoded non-OpenID
        API responses at 0.490 seconds. All required samples met the declared
        limits. The separate 2.012-second refresh-preparation navigation is
        diagnostic under the predeclared method; API responses remain gated.
        Custom 31-day and 250-event timing runs are diagnostic only; no complete
        250-event timing series passed. Pinned/full-width layout certification
        is deferred.
  - [x] Implement the approved fail-closed page-error diagnostic policy for
        future ordinary reports: the `widget-open` stage runs from activation
        through the first default List with one decoded exact-range response,
        exact returned/rendered rows, visible and enabled Create control, and
        two-frame stability. Only fully captured stacks whose first and every
        frame identify a trusted Element production bundle on the fixture
        static origin may be recorded without failing this performance
        subgate. Unknown, widget, mixed, other-origin, malformed, truncated,
        overflowed, and after-readiness errors still fail.
        Preserve previous failed reports and require all functional, timing,
        authorization, CRUD, Desktop, reminder, restore, and repository checks
        before any exact candidate can pass its separate gates.
- [x] Remove the temporary hidden widget query-state and room-calendar-list
      diagnostics from the candidate product path. Keep the E2E event-list and
      rendered-row observers, functional assertions, and fail-closed acceptance
      gates. The widget application source matches the `main` baseline; its
      only widget-source difference is the retained recurring-editor test
      split.
- [x] Complete ordinary Element Web and Desktop acceptance, including both
      appservice and normal-bot profiles, on PR #247 source
      `acc535dfe69001403c67853b2171672e74056f51`. [Hosted run
      38458532436](https://github.com/0cwa/matrix-calendar-widget/actions/runs/38458532436)
      passed authorization, CRUD, Desktop (12/12 per profile), reminder
      delivery and gateway restart, paired Radicale/PostgreSQL restore, G6
      preservation and cleanup, and browser-egress checks. The ordinary zero-
      and 25-event profile passed startup and refresh within 2 seconds, details
      within 500 ms, and API responses within 1 second. The details maxima were
      417.482 ms (appservice) and 432.221 ms (normal-bot); API maxima were
      340.8 ms and 489.573 ms respectively. Each profile had five details
      samples on 25 events and 44 API samples. Exactly two fully captured,
      trusted Element-origin opening errors per profile qualified for the
      approved opening-stage diagnostic policy; their cause is unknown. This
      is isolated application evidence, not operator or deployment acceptance.
- [ ] Run the owner-approved normal-bot-only browser acceptance for the
      integrated PR #260 candidate. The full Element Web/Desktop journey must
      pass in `bot-account` mode, including authorization, CRUD and stale-write
      rejection, reminders across gateway restart, paired Radicale/PostgreSQL
      restore, G6 unsupported-resource preservation and owned cleanup, and
      keyboard/focus, standard side-panel layout, and browser-egress checks.
      Keep the ordinary 0/25-event thresholds unchanged:
      cold activation and same-range refresh at or below 2,000 ms, each
      required decoded non-OpenID calendar API response at or below 1,000 ms,
      and all five 25-event details samples at or below 500 ms. The five
      protected checks, CodeQL, browser-layout and real Radicale/PostgreSQL
      contracts, and independent review must be bound to the exact integrated
      source. Full appservice-mode Element Web/Desktop browser certification
      is deferred until after beta; backend, identity/authentication, room
      authorization, and CalDAV contracts remain mandatory in both modes.
      The forward-merge base is `56ebedd97ffa778cb433707cbcd5a74beaafe5a7`
      (tree `529bd984f398ae1921b68189fa9a66c274e1b349`); checks on the prior
      `3643166` head or on `main` alone do not establish acceptance of the
      integrated candidate. This scope does not authorize production
      installation or rollout.
- [ ] Complete private operator readiness evidence for the merged candidate
      before any separate rollout decision. Independent review is complete
      only for PR #260's pre-integration candidate; review of the integrated
      source remains required. Full isolated local Stage B and source-bound server
      image/cache/runtime acceptance remain open, followed by actual
      target-specific deployment facts and recovery validation. The reminder
      restore helper honors explicit skip-Element mode during quiescence while
      keeping the default full Element stop and inspection path.
  - [x] Run the path-scoped real-Docker PostgreSQL first-initialization
        contract from `.github/workflows/operator-postgres-contract.yml`.
        Require restricted app-role ownership and writes, distinct
        file-backed bootstrap/app secrets with the tested UID/GID 70 app-file
        permissions, TCP readiness after initialization, and fail-closed
        startup when the app secret is missing. The hosted contract passed on
        PR #243 candidate `9e1bea6017279646808fe778aa294a8ad32b578c`. This
        synthetic contract does not validate the operator's database endpoint,
        TLS, host mounts, backup, or recovery.
  - [x] Make the opt-in hosted Docker rehearsal's endpoint mode explicit.
        Only the trusted release workflow on a GitHub-hosted Linux runner may
        select Docker CLI's default endpoint, and the helper does so only after
        validating its private Docker config and adapter plus a collision-free
        foreign-resource baseline. The normal local prebuilt path still
        requires its private non-default Unix socket. The hosted runner shares
        one daemon with the job: inventory detects foreign state but does not
        isolate or prevent damage to resources visible to that daemon. These
        environment checks select a test mode; they are not authentication.
        The earlier source-bound attempt rejected the hosted default endpoint
        before service startup. A later attempt reached fixture setup, where
        source tracing found that the runner removed the bootstrap Compose env
        file before the fixture helper loaded it, while the helper creates its
        generated server env with create-only semantics. The tooling now keeps
        a separate private bootstrap file until the generated file and Compose
        model validate, then switches later commands to that generated file.
        The complete source-bound operator rehearsal still needs a fresh pass;
        this tooling correction is not acceptance evidence.

This bounded beta path does not complete M4, M5, or the broader M8 work, and it
does not authorize publication or live rollout. The broad M8 milestone remains
open until its remaining hardening and compatibility work is dispositioned.

**M8 exit:** broad hardening is complete and the applicable release path has
recorded its evidence. A controlled beta candidate may meet the separate
bounded contract above while broader M4/M5/M8 work remains open.

## Working rule

Do not wait for a milestone to be “fully rewritten” before delivering value. Each milestone should land as small, tested vertical PRs that leave the application runnable.
