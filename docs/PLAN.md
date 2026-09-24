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

- [ ] Calendar list/sidebar.
- [ ] Create VEVENT-only calendar.
- [ ] Rename and update description/color/timezone.
- [ ] Delete calendar with safeguards.
- [ ] Detect mixed collections and expose an advanced compatibility notice.
- [ ] Hide VJOURNAL-only collections.
- [ ] Leave VTODO-only collections untouched and hidden from the main calendar UI.
- [ ] Add CalDAV URL/copy diagnostics for administrators.

Start with #92 only: friendly VEVENT-only calendar creation through the existing repository/gateway seams. Do not build generic WebDAV administration.

**Exit:** normal users no longer need Radicale's web UI to manage team event calendars.

## M5 — Recurrence and iCalendar completeness

- [ ] RRULE editor based on inherited NeoDateFix recurrence UI.
- [ ] RDATE / EXDATE.
- [ ] RECURRENCE-ID instance overrides.
- [ ] “this event / this and following / series” edit semantics where representable.
- [ ] DST and named-timezone regression suite.
- [ ] VALARM preservation and editor.
- [ ] SEQUENCE / DTSTAMP / CREATED / LAST-MODIFIED handling.
- [ ] Organizer/attendee round-trip.
- [ ] Attachments/conference properties where safely interoperable.

**Exit:** common recurring calendars round-trip with mainstream CalDAV clients.

## M6 — Matrix team features and reminders

- [ ] Matrix room ↔ calendar binding.
- [ ] Configurable Matrix power-level calendar policy.
- [ ] Team/member selector using the widget user directory/member APIs.
- [ ] Per-alarm Matrix recipient sidecar metadata.
- [ ] Selected-user mentions.
- [ ] Optional `@room` reminder with permission checks.
- [ ] Durable scheduler and idempotent delivery log.
- [ ] Event detail action to link/open a Matrix room or MatrixRTC conference.
- [ ] Audit-friendly event creation/edit messages where appropriate.

**Exit:** teams can manage the calendar entirely from the widget and receive reliable Matrix reminders.

## M7 — Non-widget fallback

- [ ] `!calendar help`
- [ ] `!calendar upcoming`
- [ ] `!calendar event <id>`
- [ ] constrained event creation command
- [ ] constrained delete/cancel command
- [ ] normal Matrix fallback messages for important widget-created calendar actions
- [ ] help text directing capable clients to the widget

**Exit:** users on non-widget clients can inspect and perform essential calendar actions without duplicating the entire UI.

## M8 — Hardening and release

- [ ] Responsive/a11y pass across narrow Element panels and full-screen widget.
- [ ] Threat model and security review.
- [ ] Rate limits and abuse controls.
- [ ] Free/busy privacy model.
- [ ] Backup/recovery documentation.
- [ ] Container images and deployment docs under fork-owned names.
- [ ] Upgrade/migration story.
- [ ] Compatibility matrix: Element Web/Desktop and other tested clients.
- [ ] Performance testing with large calendars and recurrence.
- [ ] Release/versioning policy.

**Exit:** documented deployable beta suitable for a controlled organizational pilot.

## Working rule

Do not wait for a milestone to be “fully rewritten” before delivering value. Each milestone should land as small, tested vertical PRs that leave the application runnable.
