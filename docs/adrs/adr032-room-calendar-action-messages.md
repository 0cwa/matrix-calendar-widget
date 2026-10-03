# ADR032: Send room calendar action notices

- Status: Accepted
- Date: 2026-10-03
- Preserves: ADR010, ADR014, ADR015, ADR030, and ADR027

## Context

Widget users may make a successful room-calendar event change while teammates
are using Matrix clients without the widget. A short room message gives those
clients a visible record of the action. The event itself remains canonical in
CalDAV, and the Matrix sender is a bot identity separate from the
CalDAV/OpenID service principal.

Event titles and resource names are user-controlled. A Matrix message can
notify recipients, and an end-to-end encrypted room must never receive a
plaintext fallback from a client without working encryption support. Matrix
delivery also happens after CalDAV commits, so it cannot participate in the
CalDAV transaction.

## Decision

1. Gate room calendar action notices behind
   `ROOM_CALENDAR_ACTION_MESSAGES_ENABLED`, which defaults to `false` and is
   independent of room access and event-write gates.
2. Emit notices only after a room-target create, update, or delete succeeds.
   Recheck the exact configured room/calendar binding, the SDK-authenticated
   bot sender's current joined membership, and its current `m.room.message` power
   immediately before sending. Use the authenticated Matrix widget actor as
   attribution; never derive audit identity from the CalDAV proof or caller
   supplied event fields.
3. Send a plain `m.notice` through the Matrix bot SDK's encryption-aware event
   sender. Check the room's current encryption state first. If it is encrypted,
   require crypto to be enabled and the SDK crypto client to confirm the room
   is encrypted; otherwise skip the notice. Fail closed on state lookup or
   send errors.
4. Include only the action, validated actor user ID, a sanitized bounded event
   title for create/update, and the validated collection-relative resource ID.
   Delete notices omit the title so they need no extra CalDAV read. Do not
   include CalDAV URLs, VEVENT UIDs, ETags, credentials, proofs, descriptions,
   or iCalendar data. Put an empty `m.mentions` object on the message and
   neutralize `@` in dynamic text so an action notice cannot trigger an
   automatic user or room mention.
5. Treat the message as best effort. A Matrix state or send failure must not
   roll back or turn a successful CalDAV operation into a failed widget
   request. Do not log event content or Matrix/CalDAV credentials when sending
   fails.

## Consequences

- The feature remains off until an operator explicitly enables it; enabling
  room event writes does not enable room notices.
- A permitted action produces a normal Matrix notice for clients that do not
  use the widget, provided the bot is joined, has message power, and can send
  safely for the room's encryption state.
- Matrix and CalDAV do not share a transaction. A successful CalDAV change can
  exist without a corresponding notice if the homeserver or crypto sender is
  unavailable.
- The notice exposes the event title and opaque resource ID to room members.
  It does not expose the event description, schedule, or raw calendar object.
- The pinned Matrix bot SDK (`0.7.1-crypto.beta.12`) passes a 60-second request
  timeout by default. This service does not override that timeout or have an
  abort adapter for `sendMessage`; the limit applies per request, so multiple
  state lookups and the final send can each wait for their own SDK timeout.
