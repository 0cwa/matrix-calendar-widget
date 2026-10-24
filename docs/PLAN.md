# Implementation plan

[Documentation](./README.md) · [Current status](./STATUS.md) · [Roadmap](./ROADMAP.md) · [Release evidence](./RELEASE.md)

_Reviewed 21 October 2026 against `main` at `817854b`._

This is the milestone and follow-up index. The [roadmap](./ROADMAP.md) owns priority and dependency order; the [release ledger](./RELEASE.md) owns source-specific qualification. Detailed checkboxes, test counts, and earlier attempts are preserved in the [implementation history](./archive/implementation-history.md). A completed source milestone does not certify a target deployment.

## M0 — Fork hygiene and safe baseline

**Complete.** Fork identity, Apache-2.0 provenance, workspace names, fixtures, local services, and protected CI are established. Publishing uses no inherited Nordeck target. See [upstream provenance](./UPSTREAM.md), [contributing](../CONTRIBUTING.md), and [branch protection](./BRANCH_PROTECTION.md).

## M1 — Calendar domain seam

**Complete.** The widget reads and writes through calendar-domain repository interfaces, with in-memory and HTTP-backed implementations and UI tests. See [architecture](./ARCHITECTURE.md) and the [calendar package](../packages/calendar/README.md). The [initial M1 design](./M1_DOMAIN_SEAM.md) is historical context.

## M2 — Gateway identity and Radicale discovery

**Complete for the supported scope.** The gateway validates Matrix OpenID, applies room policy, and uses tagged request-scoped proof with the project-owned Radicale auth module. Pinned service contracts cover identity, same-user enumeration, and denials before CalDAV access. Existing external Radicale stores require separate compatibility evidence. See [ADR009](./adrs/adr009-radicale-openid-delegation.md), [ADR024](./adrs/adr024-in-repo-radicale-openid-auth.md), and [Radicale auth](../radicale-auth/README.md).

## M3 — VEVENT CRUD vertical slice

**Complete for the supported scope.** Calendar reads and conditional create/update/delete operations preserve unknown source data and report stale ETag conflicts. See the [data model](./data-model.md), [fixtures](../fixtures/ical/README.md), and [event transport review](./security-caldav-event-transport.md).

## M4 — Calendar management

**Implemented:** visibility, VEVENT-only creation, rename, safe deletion, description and color, mixed-collection safeguards, and manager-only diagnostics for support tooling. The widget does not expose deployment-internal CalDAV collection URLs.

**Open:** collection timezone editing and broader management acceptance in [#5](https://github.com/0cwa/matrix-calendar-widget/issues/5). See [ADR005](./adrs/adr005-caldav-canonical-vevent-collections.md) and [ADR022](./adrs/adr022-manager-only-caldav-diagnostics.md).

## M5 — Recurrence and iCalendar completeness

**Implemented:** bounded RRULE/RDATE/EXDATE projection and authoring, PERIOD operations, named/floating/all-day time semantics, selected-occurrence timing and text, revision metadata, safe conference/URI attachment operations, and supported display-alarm metadata.

**Open:** arbitrary rule parts, general recurrence splitting and occurrence-property edits, attendee/email authoring, broader attachment/alarm/conference forms, and mainstream-client interoperability in [#6](https://github.com/0cwa/matrix-calendar-widget/issues/6). Following edits remain timing-only, finite, and limited to 128 supported members; monthly ordinal rules are excluded. Unsupported source forms may be omitted from the widget projection while the original CalDAV data is retained.

Use the [recurrence and event decision index](./adrs/README.md#calendar-semantics-and-preservation) for exact boundaries. The [historical M5 ledger](./archive/implementation-history.md#m5--recurrence-and-icalendar-completeness) retains the detailed delivered slices.

## M6 — Matrix team features and reminders

**Implemented:** room membership/power checks, exact room bindings, selected server-side principal modes, authorized room event operations, independent reminder configuration/delivery gates, persistent scheduling, and room action notices. Moderator setup can create durable dynamic bindings under its own default-off gate. Current `main` reminders target the whole room for supported timed alarms in unencrypted rooms.

**In progress:** selected-member and all-day Matrix reminder delivery in [PR #384](https://github.com/0cwa/matrix-calendar-widget/pull/384), under [#382](https://github.com/0cwa/matrix-calendar-widget/issues/382). The event-editor source now saves the canonical event before reopening Matrix settings against refreshed alarm options. Full acceptance and deployment qualification remain pending; do not count the open PR as completed baseline support. See [bot/setup guidance](./bot-calendar.md), [configuration](./configuration.md), and the [Matrix decision index](./adrs/README.md#matrix-identity-rooms-and-reminders).

**Browser contract:** [#399](https://github.com/0cwa/matrix-calendar-widget/issues/399) adds a focused check that a room manager can search full Matrix IDs, keep the filtered option stable through a member-state update, and save the exact selected recipient through the real reminder control.

## M7 — Non-widget fallback

**Implemented:** bounded `!calendar` commands and separately gated post-success room notices. [PR #383](https://github.com/0cwa/matrix-calendar-widget/pull/383) adds title-first replies, localized timing, and optional listing IDs. Source contracts cover real Matrix command delivery on synthetic services. Human acceptance in the configured pilot room remains separate. See [command syntax](./bot-calendar.md).

## M8 — Hardening and release

**Implemented:** process-local request/command limits, bounded CalDAV responses and redirect refusal, source security reviews, synthetic layout/accessibility and performance coverage, build/archive tooling, and recovery procedures. The accepted frozen source has the recorded application and hosted rehearsal evidence.

**Open:** qualify replacement sources and complete target operator readiness, live room/calendar canaries, off-server backup and isolated recovery, rollback, and daily backup activation. [#9](https://github.com/0cwa/matrix-calendar-widget/issues/9) and [#251](https://github.com/0cwa/matrix-calendar-widget/issues/251) remain open. Use [RELEASE.md](./RELEASE.md) and [beta scope](./beta-scope.md) for the current gates.

## Current product follow-ups

Tracked in [#382](https://github.com/0cwa/matrix-calendar-widget/issues/382):

- [x] Readable bot event listings and optional identifiers: merged #383.
- [x] Opt-in public VEVENT calendar subscriptions: merged #385; operational ingress, log redaction, and signing-key/share-store recovery remain installation requirements.
- [ ] Independently revocable private credentials for external CalDAV read/write access.
- [ ] Selected joined-member and all-day Matrix reminder delivery: open #384.
- [ ] Human pilot-room command/setup validation and relevant actual-client journeys.

## Repository maintainability

- [x] Calendar-only widget startup and obsolete route retirement: #275/#276.
- [x] Bounded calendar editor extraction: #258.
- [x] Human-first documentation entry points, current source map, separate historical records and agent workflow, and local documentation link/anchor checks.
- [ ] Legacy server retirement #277 after the pilot, unless explicitly re-scoped.
- [ ] Remove proven-unused packages, fixtures, and localization and add the calendar/meeting import guard in #278 after server retirement.
- [ ] Complete the remaining feedback measurements associated with #256; justify any further #257 extraction by a concrete reduction in change scope. See [cleanup baseline](./cleanup-baseline.md).

Keep changes small enough to review and leave the application runnable. Update this index when the milestone or follow-up state changes; put new procedural guidance in the relevant guide and exact execution evidence in its dedicated record.
