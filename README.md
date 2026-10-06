# Matrix Calendar Widget

> **Status: pre-alpha.** This repository is a hard fork of Nordeck's NeoDateFix / `matrix-meetings` project and is being converted into a Matrix-first team calendar backed by CalDAV/Radicale.

The primary product is a responsive Matrix widget for Element and other widget-capable clients. Its current supported scope is VEVENT calendars and events with bounded recurrence and preservation-first editing. Collection-timezone editing, attendee/email authoring, individual reminder recipients, arbitrary RRULE editing, and attachment or conference authoring beyond the accepted bounded conference-link operation remain deferred or unsupported. The Matrix bot provides bounded room-calendar commands as a fallback when widget support is unavailable.

The bounded controlled-beta target is defined in [docs/beta-scope.md](./docs/beta-scope.md): Element Web and Desktop, one server replica, an independent project-owned Radicale store, and a separate app-owned PostgreSQL reminder store. Client and operator acceptance remain open; defining this scope does not authorize publication or rollout.

## Product principles

- **The widget is the product.** Commands are a compatibility fallback, not a parallel UI.
- **CalDAV is canonical.** Radicale remains the source of truth for calendars and iCalendar objects.
- **Create simple collections.** Calendars created by this project are VEVENT-only. Existing mixed collections are tolerated and preserved.
- **Do not surface dead complexity.** VJOURNAL is not a first-class feature. VTODO may become a separate task-list feature later.
- **Preserve interoperability.** Editing an event must not silently discard iCalendar properties the widget does not understand.
- **Disclose partial projection.** Unsupported recurrence or timezone data that the bounded projector cannot handle may be omitted from the widget's visible projection. The widget warns for source forms it diagnoses, but does not guarantee every unsupported form is detected. The original resource remains in CalDAV; a warning-free view is not a complete export of every resource.
- **Matrix identity, not Matrix passwords.** The widget authenticates to our gateway using Matrix widget/OpenID flows. It must never ask users for their Matrix password.
- **Room reminder boundary.** Scheduled reminders use whole-room `m.mentions.room` and are limited to unencrypted rooms. Configuration and delivery are separate default-off capabilities; the native sender refuses encrypted or unknown room state.
- **Track MSC4496 without depending on it.** Our domain model should map cleanly to the proposal while it remains unstable.

## Current state

M0–M3 are complete for the supported scope, including widget CRUD, user-scoped Matrix OpenID access, and pinned personal-access/event contracts against the project-owned Synapse/Radicale test stack. These contracts do not validate a production host or the etke-managed Radicale service and its existing `/data` store.

M4 includes calendar visibility, VEVENT-only calendar creation, rename, safe deletion, description and color editing, mixed-collection safeguards, and manager-only CalDAV diagnostics. Collection-timezone editing remains deferred. M5 supports a documented bounded recurrence and iCalendar subset, including RRULE/RDATE/EXDATE, PERIOD, supported DISPLAY alarms, revision metadata, bundled-timezone projection, selected-occurrence timing edits, and typed EXDATE skip/restore. PR #197 adds bounded, revalidated external links as anchors without previews or fetches. PR #200 adds timing-only this-and-following edits for finite supported series with at most 128 members; it preserves one resource and rejects alarms, RDATE/EXDATE data, unsafe detached suffixes, and unsupported timing. PR #215 adds one monthly ordinal weekday selector; PR #217 adds authoring for one safe master conference link. Broader recurrence properties, additional RRULE parts, arbitrary rule splitting, and client/server interoperability remain open; attendee/email, individual reminder recipients, attachment authoring, and conference forms beyond ADR036 remain unsupported or deferred.

M6 room reads (#164) and event mutations (#193) use current actor authorization and exact operator-configured room/calendar bindings; `ROOM_CALENDAR_ACCESS_ENABLED` and `ROOM_CALENDAR_EVENT_WRITES_ENABLED` remain separate default-off gates. PR #201 connects the primary widget to the authorized room calendar, displays the current Matrix room link in event details, and provides reminder settings for supported alarms to authorized managers. PR #199 adds the reminder APIs, bounded scheduler lifecycle, native Matrix transport, and post-success room-target widget action notices. All eight hosted checks passed on PR #201's exact tree `a65811903363397ea0883f4e32a98ace7dfdb9a8`, independently reviewed at the same tree and merged as `f49acee71280944ad6ae351111947ff01c00031d`. Reminder configuration, delivery, and action notices remain independently default-off through `MATRIX_CALENDAR_REMINDER_CONFIGURATION_ENABLED`, `ROOM_CALENDAR_REMINDER_DELIVERY_ENABLED`, and `ROOM_CALENDAR_ACTION_MESSAGES_ENABLED`; delivery also requires room access and the app-owned PostgreSQL store. The Radicale service principal has whole-home `owner_only` rights; binding checks scope access in the gateway, not in Radicale. Actual Element-client and operator-host acceptance remain open.

M7 provides bounded `!calendar upcoming`, `event`, `create`, and `delete`/`cancel` commands. The Matrix sender is actor context, not the CalDAV identity. Replies use the Matrix SDK's encryption-aware sender and fail closed when encrypted-room support cannot be confirmed. PR #198 bounds command work before Matrix state and CalDAV operations; its counters are process-local. PR #199 adds separate opt-in best-effort notices after successful room-target widget event mutations. Notices suppress automatic mentions and do not roll back a successful CalDAV change; they do not establish scheduled reminder delivery or encrypted reminder support.

M8 includes process-local calendar-gateway and bot-command limits, bounded CalDAV responses, redirect refusal, and discovery href confinement. Hosted browser evidence includes ten total room-control cases (PR #213), then twelve total list/month cases with a prepared 1,000-event benchmark (PR #216); all use synthetic components. The 1,000-event month samples include a long task up to 2.63 seconds; this is not a capacity promise. These results do not validate Element Web/Desktop. The project remains pre-alpha: operator validation of proxy/log behavior, the selected project-owned Radicale deployment, PostgreSQL TLS/CA, backups, and recovery is still required. An existing etke image override or data-store reuse is required only if that reuse is selected. No live deployment or publication is authorized.

## Start here

- [AGENTS.md](./AGENTS.md) — rules for humans and coding agents
- [Architecture](./docs/ARCHITECTURE.md)
- [Implementation plan](./docs/PLAN.md)
- [Current project status](./docs/STATUS.md)
- [Controlled beta scope and acceptance](./docs/beta-scope.md)
- [Security policy](./SECURITY.md)
- [Threat model](./docs/threat-model.md) — current trust boundaries, controls, and open risks
- [Roadmap](./docs/ROADMAP.md)
- [Development guide](./docs/DEVELOPMENT.md)
- [Upstream provenance](./docs/UPSTREAM.md)
- [Upgrade and migration runbook](./docs/upgrade-migration.md)
- [Free/busy privacy policy](./docs/free-busy-privacy.md)
- [Architecture decisions](./docs/adrs/)

## Development

Node.js 22 and Yarn 1.22 are recommended.

```bash
corepack enable
yarn install --frozen-lockfile
yarn ci
yarn dev
```

For Matrix/Radicale integration work, start the pinned local services with `yarn dev:services:up`. See [dev/README.md](./dev/README.md).

## Upstream

Baseline imported from:

- Repository: `nordeck/matrix-meetings`
- Commit: `2d3011f665af04c3cd376c388f7ae3bcb06bba25`
- Import commit in this repository: `387a3292d1a1ffce4d109762608d421f79ba1392`

See [docs/UPSTREAM.md](./docs/UPSTREAM.md) before attempting an upstream sync.

## License

Apache License 2.0. The original Nordeck copyright, NOTICE files, and attribution must be retained for inherited code as required by the license.
