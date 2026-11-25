# ADR047: Read the reminder recipient roster from Matrix through the gateway

[Decision index](./README.md) · [Architecture](../ARCHITECTURE.md)

- Status: Accepted
- Date: 2026-10-24
- Scope: Recipient options for selected-user Matrix reminders
- Preserves: ADR006, ADR028, ADR033, ADR041, ADR043, and ADR044

## Context

The selected-user reminder picker needs a complete view of the room's current
joined members. Element can lazily load member state, and its widget API exposes
the room state already available to the client. That cache may be empty or
partial. A picker populated from it can hide joined people even while the
gateway remains able to verify their membership when a manager saves a
reminder.

The reminder gateway already has bounded Matrix Client-Server transports for
both the configured application-service principal and the optional normal bot
account. Those transports read the full `joined_members` endpoint and apply
current membership checks for reminder configuration and delivery.

## Decision

1. Add a read-only `GET
/v1/calendar/rooms/:roomId/reminders/recipients` endpoint under the same
   default-off reminder-configuration and room-calendar-access gates. Require
   the current validated Matrix actor, joined membership, current
   `io.github.0cwa.matrix-calendar.manage` power, unencrypted room state, and
   the exact ready room/calendar binding before reading or returning roster
   data. Use the same authorization helper as reminder configuration.
2. Read the current roster from Matrix's complete `joined_members` response
   through the process-selected reminder transport. Appservice mode and
   bot-account mode use their existing server-held credentials and bounded
   request, response-size, timeout, redirect, and rate controls. The route
   takes its room ID only from the bound room route; it accepts no calendar
   URL, recipient, principal, or credential input.
3. Return only `{ recipients: [{ userId, displayName }] }`. Each `userId` is a
   canonical Matrix user ID. `displayName` is a normalized string or `null`.
   Do not return member events, avatar URLs, profile data beyond the display
   label, tokens, room state, or transport errors. Set `Cache-Control:
no-store`. A failed or malformed Matrix response returns a fixed unavailable
   response and no partial roster.
4. Load picker options from the gateway repository capability. A server that
   does not implement this capability cannot offer selected recipients; the
   widget shows an unavailable state and a retry action. It must not substitute
   the Element cache or present an incomplete list as complete.
5. Element member-state observations may request a fresh gateway roster for
   the current room. They never establish completeness or membership
   authority. A refresh replaces the displayed labels and joined-member
   options while keeping selected IDs and the current search query. The picker
   may also refresh on open or after a save is refused for stale membership.
6. Keep the existing configuration-time joined-membership check before any
   CalDAV source read or sidecar write. Keep the scheduler's current binding,
   encryption, sender, power, and recipient intersection checks immediately
   before delivery. A stale roster is never authorization to configure or
   deliver to a member who has left.
7. Keep selected-recipient limits, reminder persistence, delivery identity,
   all-day schedules, whole-room mentions, and canonical CalDAV alarm behavior
   unchanged. The roster is transient API data and adds no persisted state.

## Consequences

Managers can choose any joined member returned by the homeserver even when an
Element client's member cache has not loaded. Display names improve the picker
label but are optional; a missing or invalid label falls back to the Matrix
user ID in the widget. A roster transport failure prevents selected-recipient
saves until a successful retry, while other reminder controls remain available.

The roster is a manager-only projection of current room membership, not a
general Matrix profile API. Save-time and delivery-time checks remain necessary
because room membership can change after the roster response.

## Acceptance gates

- Controller and service tests prove unauthenticated, non-member,
  non-manager, encrypted, unknown-encryption, and unbound requests do not call
  the dedicated roster method or return roster data.
- Both reminder transport modes parse the complete `joined_members` response,
  normalize optional display names, and preserve existing timeout, response
  size, redirect, cancellation, and credential-redaction behavior.
- Gateway tests prove the route uses the canonical Matrix room ID from the
  bound repository configuration and rejects malformed or over-limit roster
  responses without partial output.
- Widget tests and the browser contract prove an empty host cache does not
  suppress server roster options, member updates refresh labels and removals,
  full Matrix IDs remain searchable, and selected IDs and query text survive a
  refresh.
- Existing save-time current-membership rejection and delivery-time
  intersection tests continue to pass.
