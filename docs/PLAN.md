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
- [x] Update calendar description and color (#5; locally validated and ready for integration).
- [ ] Update calendar time zone (#5; deferred beyond M4 until pinned Radicale query and property round-trip semantics are verified).
- [ ] Delete calendar with safeguards (#100 / PR #101).
- [x] Detect mixed collections and expose an advanced compatibility notice.
- [x] Hide VJOURNAL-only collections.
- [x] Leave VTODO-only collections untouched and hidden from the main calendar UI.
- [x] Add CalDAV URL/copy diagnostics for administrators.

Calendar creation (#94), lightweight visibility controls (#96), and rename (#99) are merged. The active M4 slice remains #100 / PR #101: safe deletion of explicitly writable VEVENT-only calendars. The description/color and collection-compatibility portions of #5 are locally validated and ready for integration; mixed collections show VEVENTs with a warning, while unsupported-only collections stay untouched and hidden. Issue #5 remains incomplete while timezone editing is deferred pending pinned Radicale query and property round-trip validation. Keep collection writes explicit to the supported properties.

The recurrence presentation policy remains viewer-local for DATE and floating values during expansion and display; it does not write collection timezone properties. Any future `Calendar.timezone` write requires verified query and client semantics for the pinned Radicale deployment, including collection-property round-trip behavior.

**Exit:** normal users no longer need Radicale's web UI to manage team event calendars.

## M5 — Recurrence and iCalendar completeness

- [x] Supported RRULE series editor based on inherited NeoDateFix recurrence UI; unsupported loaded rules are preserved until explicitly replaced.
- [x] RDATE / EXDATE series editing with explicit DATE, floating, UTC, and TZID values.
- [x] RECURRENCE-ID instance overrides for generated and RDATE-only occurrences: edit or cancel one instance through a same-resource conditional write (ADR012).
- [x] Preserve existing detached exceptions when a series edit retains their typed recurrence identities; refuse RRULE, DTSTART, RDATE, or EXDATE edits that orphan or cannot safely verify an exception before PUT (ADR016).
- [x] Add range-bounded read expansion for resource RRULE/RDATE/EXDATE sets, RDATE PERIOD durations, same-resource exceptions, and supported timing-only `RANGE=THISANDFUTURE` changes (ADR017).
- [x] Present generated occurrences in the visible range using the viewer-local timezone for DATE and floating recurrence values, with stable original recurrence identities; explicit UTC/TZID values remain unchanged and unsupported expansion is shown as a warning (ADR011 carries opaque ranged-override diagnostics without interpreting or rewriting the source component; ADR013 records the timezone policy).
- [x] “This and following” timing edits where RFC 5545 semantics are representable; unsupported or ambiguous range components fail before PUT (ADR017).
- [ ] Whole-series edit semantics beyond the current recurrence editor.
- [ ] DST and named-timezone regression suite.
- [x] Preserve multiple VALARMs, including unsupported actions, across ordinary and recurrence-only patches without executing them.
- [x] Preserve SEQUENCE / DTSTAMP / CREATED / LAST-MODIFIED unchanged across supported patches.
- [x] Preserve organizer and repeated attendee values/parameters across supported patches.
- [x] Preserve repeated ATTACH and CONFERENCE values, types, and parameters; the server codec performs no automatic URI fetch.
- [x] Edit trigger and description on existing DISPLAY alarms while unsupported actions remain inert (ADR018).
- [x] Explicitly add and remove master-event DISPLAY alarms. New alarms receive
      one RFC 9074 VALARM UID, a localized description, and a trigger 15 minutes
      before event start; existing UID-less alarms remain intact (ADR020).
- [x] Add a gated Radicale contract for recurring-resource create/read/patch with a master, moved and cancelled overrides, RRULE/RDATE/EXDATE, and a named timezone in one resource.
- [ ] Run that recurring-resource contract against pinned Radicale 3.8.0.0; local runtime blocker and exact command are recorded in `docs/STATUS.md`.

The current series editor locks timed/all-day conversion while recurrence data is present. Visible recurring occurrences retain their backing resource ID and original recurrence ID. Editing or cancelling one instance uses a same-resource conditional override and leaves the master and sibling occurrences intact. A separate timing-only “this and following” action writes RFC 5545 `RANGE=THISANDFUTURE`; it keeps the original recurrence identity, changes start time and duration from that boundary forward, and refuses unknown or unsupported boundary data before PUT. Whole-series edit semantics remain separate work.

Series edits that change occurrence membership are checked against every existing detached exception before the resource is written. The server preserves exceptions whose exact original recurrence identities remain and refuses edits that remove an identity or whose membership cannot be proven; it does not remap or delete exceptions.

The fixture-backed server codec check asserts that parsing and patching do not fetch stored URIs; it does not exercise browser navigation. Users can explicitly add or remove DISPLAY alarms; new events remain alarm-free unless the user adds one. New alarms use one RFC 9074 UID, a localized description, and a 15-minute-before-start default (ADR020). Existing UID-less alarms, unsupported actions, and unknown properties remain unchanged. Alarm execution, Matrix reminder configuration and scheduling, and attachment/conference UI actions remain separate work.

The gated recurring-resource CalDAV contract is defined in `matrix-calendar-server/test/integration/CalDavEventRoundTripContract.test.ts`. M5 remains open until that contract passes against the pinned Radicale service; see `docs/STATUS.md` for the current local runtime blocker.

**Exit:** common recurring calendars round-trip with mainstream CalDAV clients.

## M6 — Matrix team features and reminders

- [x] Room widgets use the single server-bound calendar with no calendar target
      selector or collection lifecycle controls; event actions remain available,
      and personal-mode calendar controls are preserved.
- [ ] Define and enforce the server-managed canonical room ID → app-owned
      calendar binding in ADR015. Initial bindings are configuration-managed;
      the browser and room members cannot create or change the map. M6 widget
      requests and M7 commands resolve only the mapped calendar, after actor,
      membership, and action-power checks, and before CalDAV. Missing,
      malformed, duplicate, ambiguous, or cross-room mappings fail closed.
      Room-bound widget and bot targets use the server-side app principal;
      personal widget targets continue to use the validated user's principal
      (ADR014). Actual room-target CalDAV access still depends on #48/#45 and
      the app principal's trusted-domain isolation. With the initial static
      binding, the widget reads and manages events in its bound collection;
      collection creation, deletion, rename, and rebinding remain
      operator/configuration-managed. Dynamic database, room-state, or
      widget-managed binding or collection lifecycle requires a later ADR.
- [ ] Configurable Matrix power-level calendar policy.
- [x] Choose whole-room `@room` as the first reminder target. Defer event
      email attendee fields, verified-address registration, and invitation/
      response semantics until member addresses can be verified and their
      owners give explicit consent. Matrix membership/member APIs do not expose
      other members' email addresses; never infer email from a Matrix ID.
- [x] Add an authenticated room API that stores per-alarm Matrix reminder
      intent through the PostgreSQL store (ADR007/ADR019). It checks room
      membership and event-write policy but does not prove that the referenced
      event, recurrence instance, or VALARM exists in CalDAV.
- [ ] Wire the widget's reminder controls to the authenticated configuration
      API.
- [x] Add a pure resolver that checks persisted event UID, canonical recurrence
      identity, and RFC 9074 VALARM UID against supplied canonical CalDAV data.
      It fails closed for absent, malformed, changed, or ambiguous identities
      and does not fetch resources or send notifications (ADR020).
- [ ] Fetch the current canonical CalDAV resource and invoke the resolver
      before enabling reminder use; recheck room authorization at delivery time.
- [x] Implement the optional app-owned PostgreSQL reminder-state store and
      atomic durable delivery claims (ADR019). The store has local unit coverage
      and a PostgreSQL integration contract wired into CI; the API persists
      inert configuration only and does not enable reminder delivery.
- [ ] Deliver reminders through standard `m.mentions.room: true` with
      scheduling and delivery-time permission checks. Delivery is at-least-once;
      a Matrix send followed by a process crash before sent-state persistence
      can cause a retry duplicate. Optional selected-user Matrix mentions remain
      separate from email attendee targeting.
- [ ] Durable scheduler integrated with the delivery claim store.
- [ ] Event detail action to link/open a Matrix room or MatrixRTC conference.
- [ ] Audit-friendly event creation/edit messages where appropriate.

The PostgreSQL reminder-state store and chart integration are implemented
locally. The chart requires operators to provision an app-owned database/role
and external Secret before enabling reminders. Existing `/app/storage` PVC
settings remain independent bot filesystem state and are unchanged. The chart
defaults to one app replica; database claims do not establish full server
multi-replica safety.

Local progress only: the gateway actor/membership/power/binding preflight and
the static single-target room widget UI are complete on local branches. These
sub-slices do not enable live room-principal CalDAV access and do not complete
M6 or issue #7. Widget reminder controls, CalDAV event/alarm resolution,
scheduling, delivery-time permission rechecks, Matrix delivery, and event
attendee email semantics remain open; the authenticated API currently stores
inert intent only. A pure canonical event/recurrence/alarm identity resolver is
implemented and fixture-tested, but current-resource lookup and reminder use
remain pending.
Live room delivery still depends on #48/#45 and ADR014's trusted-domain isolation gate; the M5 pinned
Radicale recurring-resource run remains a separate open interoperability gate.

**Exit:** teams can manage events in their configured room calendar from the
widget and receive reliable Matrix reminders. Room bindings and calendar
collection lifecycle remain operator/configuration-managed under ADR015.

## M7 — Non-widget fallback

- [x] `!calendar help`
- [ ] `!calendar upcoming`
- [ ] `!calendar event <id>`
- [ ] constrained event creation command
- [ ] constrained delete/cancel command
- [ ] normal Matrix fallback messages for important widget-created calendar actions
- [ ] help text directing capable clients to the widget

The M7 data commands (`upcoming`, `event`, create, and delete/cancel) use the
same server-side OpenID-backed bot service principal as room-bound widget targets,
and only for the app-owned room calendar resolved from the server-managed
configuration map in ADR015. The command's authenticated room context selects
the mapping; a sender ID or browser-supplied href/URL does not select a target.
A room-bound widget
request validates the widget user's OpenID as the actor; a bot command
validates its homeserver-sourced event actor. Both check membership, action
power, and the room/calendar binding before CalDAV access. Missing, malformed,
duplicate, ambiguous, or cross-room mapping data fails closed. Personal widget
targets continue to use the validated user's principal. M7 data commands
require the M2 OpenID-capable Radicale plugin and delegated contract (#48 and
#45), plus the M6 room binding and server-side checks (ADR014/ADR015). They must not
use a Matrix sender ID as a CalDAV identity or target selector. Per-user bot
command targets remain deferred until a trusted proof of the sender's identity
and explicit target-calendar authorization are available.

**Exit:** users on non-widget clients can inspect and perform essential calendar actions without duplicating the entire UI.

## M8 — Hardening and release

- [ ] Responsive/a11y pass across narrow Element panels and full-screen widget.
- [ ] Threat model and security review.
- [ ] Rate limits and abuse controls.
- [x] Document the initial free/busy privacy boundary; no aggregate availability surface is provided yet ([docs/FREE_BUSY_PRIVACY.md](./FREE_BUSY_PRIVACY.md)).
- [ ] Backup/recovery documentation.
- [ ] Container images and deployment docs under fork-owned names.
- [ ] Upgrade/migration story.
- [ ] Compatibility matrix: Element Web/Desktop and other tested clients.
- [ ] Performance testing with large calendars and recurrence.
- [ ] Release/versioning policy.

**Exit:** documented deployable beta suitable for a controlled organizational pilot.

## Working rule

Do not wait for a milestone to be “fully rewritten” before delivering value. Each milestone should land as small, tested vertical PRs that leave the application runnable.
