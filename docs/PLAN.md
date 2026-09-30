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
- [ ] Configure main-branch protection after CI status checks exist.

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
- [ ] Add OpenID-capable Radicale auth support while preserving password-based CalDAV clients (#48).
- [ ] Add the final delegated gateway/OpenID contract against a real Radicale container (#45).

Password-auth real-container discovery is already covered by #59 / PR #60. The only remaining M2 path is the external ADR009 plugin change (#48), then the final delegated gateway contract (#45).

**Exit:** an authenticated widget can list the Radicale calendars it is authorized to see through delegated Matrix OpenID without handling user Matrix passwords.

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
- [x] Add weekly BYDAY creation/editing and projection for plain weekday
      tokens when DTSTART's weekday is included, INTERVAL is omitted or 1,
      COUNT/UNTIL and other rule parts are absent, and WKST is omitted or its
      default MO. Unsupported combinations remain opaque and preserved.
- [ ] Extend RRULE editing to additional recurrence rule parts and patterns.
- [x] Skip and restore one projected supported occurrence by adding or
      removing only its matching EXDATE. Use the original recurrence identity
      even when a detached override moves the displayed instance, and preserve
      the DATE/floating/UTC/TZID value kind and local wall time.
- [ ] General RDATE / EXDATE editing.
- [ ] RECURRENCE-ID instance override editing.
- [ ] “this event / this and following / series” edit semantics where representable.
- [ ] DST and named-timezone regression suite.
- [ ] VALARM preservation and editor.
- [ ] SEQUENCE / DTSTAMP / CREATED / LAST-MODIFIED handling.
- [ ] Organizer/attendee round-trip.
- [ ] Attachments/conference properties where safely interoperable.

The recurring-resource contract uses the hosted CI stack pinned to Synapse
v1.161.0 and Radicale 3.8.0.0 with `radicale_auth_matrix`. A passing result
validates this stack only; the broader issue #6 criteria and M5 exit remain open.

PR #130 completes the first write slice: recurrence controls are limited to
four frequencies, interval, and an optional count or inclusive end date.
Writes replace or clear only the master RRULE and use the existing source
resource ID and ETag. Resources with
RDATE, EXDATE, detached instances, multiple master RRULEs, unsupported RRULE
parts, or unsupported timezone rules remain readable; recurrence controls stay
disabled, and ordinary field edits preserve the complete source resource.

The bounded weekly BYDAY slice extends the editor with a weekday set for
every-week rules. Plain weekday tokens are accepted only when DTSTART's
weekday is included, INTERVAL is absent or 1, COUNT and UNTIL are absent, no
other RRULE parts are present, and WKST is absent or the default MO. A weekly
rule outside this shape stays opaque in the projector and is not editable;
unrelated event edits preserve its original RRULE and resource data. Full
recurrence editing and client interoperability remain open.

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
and unknown properties. EXDATE values keep the projected identity's DATE,
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

- [x] Wire the zero-I/O `target=room` authorization preflight into calendar
      operations: check joined membership and power before resolving the
      operator-managed static binding. The room access gate stays disabled and
      performs no CalDAV I/O.
  - [x] Define the operator-managed static room-to-calendar contract (ADR014/
        ADR015) and validate bindings in server configuration before lookup.
  - [x] Add a pure room-binding resolver and joined-membership/power policy
        service that denies on lookup errors. Existing user-principal room-
        context routes remain active and use the authenticated user's
        principal.
- [ ] Enable live room-calendar data access and room-target diagnostics only
      after the M2 OpenID-capable Radicale plugin and same-user delegation
      contract are validated, and M6 separately validates application-principal
      credential provisioning, authorization, a Radicale contract under that
      principal, and cross-room isolation. M2's user-scoped contract does not
      validate application-principal credentials, and closing M2 does not
      prove those M6 gates. Keep issue #7 open for real room calendar
      operations.
- [ ] Per-alarm Matrix recipient sidecar metadata.
- [ ] First reminder delivery target: permission-checked room-wide
      notifications using standard `m.mentions.room: true`; check room-mention
      permission again at delivery time (ADR007/ADR019).
- [x] App-owned PostgreSQL reminder persistence, schema migrations, and
      transactional claim/completion contract are implemented (ADR019). The
      restricted-role PostgreSQL 16 integration job passed all five hosted
      contract tests in PR #111 (run 36358734009). Database claims provide
      at-most-once claim/completion state, not exactly-once Matrix message
      delivery, and do not enable the scheduler or message delivery.
- [x] Default optional reminder database connections to verified TLS; allow
      plaintext only with explicit `trusted-private-network` mode for an
      operator-controlled isolated network (ADR021).
- [ ] Validate the production connection against an operator-controlled
      PostgreSQL endpoint and its trusted CA/certificate configuration. No
      endpoint or CA/certificate configuration has been supplied; production
      TLS/CA and runtime validation therefore remain open.
- [ ] Durable scheduler and idempotent delivery log.
- [ ] Event detail action to link/open a Matrix room or MatrixRTC conference.
- [ ] Audit-friendly event creation/edit messages where appropriate.

Room-wide reminders are the accepted v1 recipient flow: send only
permission-checked `m.mentions.room: true` notifications and recheck permission
at delivery time. Individual Matrix-recipient selection is outside the
accepted v1 scope and requires a later explicit scope decision. Email
attendee/address collection is separately deferred until members can
explicitly verify and consent to share an address; do not infer email
addresses from Matrix room membership.

**Exit:** teams can manage events in the configured room calendar from the widget and receive reliable Matrix reminders. Collection lifecycle and room bindings remain operator-managed under ADR015.

## M7 — Non-widget fallback

- [x] `!calendar help`
- [ ] `!calendar upcoming`
- [ ] `!calendar event <id>`
- [ ] constrained event creation command
- [ ] constrained delete/cancel command
- [ ] normal Matrix fallback messages for important widget-created calendar actions
- [x] help text directing capable clients to the widget

**Exit:** users on non-widget clients can inspect and perform essential calendar actions without duplicating the entire UI.

## M8 — Hardening and release

- [ ] Responsive/a11y pass across narrow Element panels and full-screen widget.
- [ ] Threat model and security review.
- [ ] Rate limits and abuse controls.
- [ ] Free/busy privacy model.
- [ ] Backup/recovery documentation.
- [ ] Container images and deployment docs under fork-owned names.
  - [x] Document the current Docker build/runtime contracts and the generic operator-run etke/MDAD compatibility boundary.
  - [x] Add non-publishing CI image-build smoke checks with fork-owned local tags; PR #102 run 36316604092 passed both image build steps at `0da7f3345e603e808231a24cc2ed6d979bea987a` without publishing.
- [ ] Upgrade/migration story.
- [ ] Compatibility matrix: Element Web/Desktop and other tested clients.
- [ ] Performance testing with large calendars and recurrence.
- [ ] Release/versioning policy.

**Exit:** documented deployable beta suitable for a controlled organizational pilot.

## Working rule

Do not wait for a milestone to be “fully rewritten” before delivering value. Each milestone should land as small, tested vertical PRs that leave the application runnable.
