# Architecture decisions

[Documentation](../README.md) · [Architecture](../ARCHITECTURE.md) · [Data model](../data-model.md) · [Contributing](../../CONTRIBUTING.md)

An architecture decision record (ADR) explains a consequential design choice and its tradeoffs. Read the records relevant to your change; the [architecture guide](../ARCHITECTURE.md) is the shorter introduction to the current implementation. An accepted design is not by itself proof of implementation, client compatibility, or deployment readiness: use [status](../STATUS.md) and [release evidence](../RELEASE.md) for those questions.

## Reading the history

ADR001–ADR003 were inherited from NeoDateFix and describe its meeting product. Fork decisions start at ADR004. Later decisions can narrow or extend earlier ones: ADR014 clarifies target-dependent principals, ADR041 adds the normal-bot option, ADR043 extends static bindings with optional moderator setup, and ADR045 introduces public read-only shares without replacing private OpenID authentication. Keep earlier decisions for context rather than renumbering or deleting them.

## Foundations

| Record                                                    | Decision                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| [ADR004](./adr004-hard-fork-neodatefix.md)                | Hard-fork NeoDateFix as the implementation baseline           |
| [ADR005](./adr005-caldav-canonical-vevent-collections.md) | CalDAV is canonical and new calendars are VEVENT-only         |
| [ADR006](./adr006-matrix-authenticated-caldav-gateway.md) | Use a Matrix-authenticated gateway between widgets and CalDAV |
| [ADR008](./adr008-align-with-msc4496.md)                  | Align with MSC4496 without requiring it                       |

## Matrix identity, rooms, and reminders

| Record                                                                | Decision                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [ADR007](./adr007-matrix-reminder-sidecar-metadata.md)                | Model Matrix reminder targets as sidecar metadata                |
| [ADR009](./adr009-radicale-openid-delegation.md)                      | Delegate Matrix OpenID to Radicale without Matrix passwords      |
| [ADR010](./adr010-mixed-calendar-principal-model.md)                  | Use personal widget calendars and room-owned bot calendars       |
| [ADR014](./adr014-split-widget-and-bot-calendar-principals.md)        | Select calendar principals by target                             |
| [ADR015](./adr015-server-managed-room-calendar-bindings.md)           | Manage room/calendar bindings in server configuration            |
| [ADR022](./adr022-manager-only-caldav-diagnostics.md)                 | Expose manager-only CalDAV collection diagnostics                |
| [ADR024](./adr024-in-repo-radicale-openid-auth.md)                    | Own a clean-room OpenID authentication module for Radicale       |
| [ADR028](./adr028-room-reminder-configuration-and-delivery.md)        | Configure room reminders against canonical calendar alarms       |
| [ADR030](./adr030-gated-room-event-operations.md)                     | Gate room-owned event operations                                 |
| [ADR032](./adr032-room-calendar-action-messages.md)                   | Send room calendar action notices                                |
| [ADR033](./adr033-room-reminder-alarm-options.md)                     | Bounded room reminder alarm options                              |
| [ADR041](./adr041-optional-normal-bot-account-for-room-operations.md) | Support an optional normal bot account for room operations       |
| [ADR042](./adr042-calendar-only-legacy-meeting-apis-disabled.md)      | Disable legacy meeting APIs for the calendar pilot               |
| [ADR043](./adr043-moderator-room-calendar-setup.md)                   | Set up a room calendar through a moderator command               |
| [ADR047](./adr047-authoritative-reminder-recipient-roster.md)         | Read selected-reminder recipients from current Matrix membership |

## Calendar semantics and preservation

| Record                                                         | Decision                                             |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| [ADR023](./adr023-floating-recurrence-semantics.md)            | Preserve floating date-times and RFC durations       |
| [ADR025](./adr025-icalendar-event-revision-metadata.md)        | Manage iCalendar event revision metadata             |
| [ADR029](./adr029-recurrence-instance-timing-edits.md)         | Bounded RECURRENCE-ID instance timing edits          |
| [ADR031](./adr031-safe-calendar-external-links.md)             | Safely display external links from calendar events   |
| [ADR034](./adr034-bounded-following-timing-edits.md)           | Bounded this-and-following timing edits              |
| [ADR035](./adr035-monthly-ordinal-weekday-recurrence.md)       | Bounded monthly ordinal weekday recurrence authoring |
| [ADR036](./adr036-bounded-conference-link-authoring.md)        | Bounded authoring of one conference link             |
| [ADR038](./adr038-bounded-safe-uri-attachment-authoring.md)    | Bounded authoring of safe URI attachments            |
| [ADR039](./adr039-calendar-absolute-display-alarm-metadata.md) | Calendar-only absolute DISPLAY alarm metadata        |
| [ADR040](./adr040-selected-occurrence-text-fields.md)          | Bounded selected-occurrence text edits               |

## Storage, privacy, and operations

| Record                                                               | Decision                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| [ADR019](./adr019-postgresql-reminder-sidecar-store.md)              | Store Matrix reminder state in app-owned PostgreSQL       |
| [ADR021](./adr021-postgresql-verified-tls.md)                        | Verify PostgreSQL transport by default                    |
| [ADR026](./adr026-bounded-calendar-gateway-rate-limits.md)           | Bound pre-authentication calendar gateway requests        |
| [ADR027](./adr027-free-busy-privacy-boundary.md)                     | Restrict free/busy to an authorized, minimal projection   |
| [ADR037](./adr037-independent-radicale-store-for-controlled-beta.md) | Use an independent Radicale store for the controlled beta |
| [ADR045](./adr045-public-calendar-feeds.md)                          | Publish opt-in, VEVENT-only public calendar feeds         |

## Inherited meeting architecture

| Record                                                                     | Decision                                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [ADR001](./adr001-use-the-widget-api-to-interact-with-the-meetings-bot.md) | Use the Widget API to interact with the Meetings Bot to Create, Manage, and Display Meetings |
| [ADR002](./adr002-use-redux-toolkit-query.md)                              | Use Redux Tookit Query (RTK Query)                                                           |
| [ADR003](./adr003-recurring-meetings.md)                                   | Recurring Meetings                                                                           |

## Propose or change a decision

Use the [ADR template](./adr000-template.md) for a change to persistence, authentication, public APIs, permissions, calendar semantics, or deployment topology. Explain the context, decision, consequences, and how it relates to existing records. Routine implementation and documentation changes do not need a new ADR.

Preserve established numbers. Gaps are intentional; inspect open PRs before assigning a number. At the 21 October 2026 documentation snapshot, ADR044 belongs to the still-open reminder work in [PR #384](https://github.com/0cwa/matrix-calendar-widget/pull/384); it is not a merged decision in this index. ADR047 adds the manager-authorized roster read needed to complete that picker in clients with partial member caches.
