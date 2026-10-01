# ADR014: Select calendar principals by target

- Status: Accepted
- Date: 2026-09-26

## Context

ADR006 and ADR009 establish per-user Matrix OpenID delegation for personal
widget calendar targets. M6 also requires teams to manage room calendars from
the widget. A room-bound widget request must therefore authenticate the user
as the actor while the server accesses the room calendar under its app-owned
principal.

A Matrix bot command has a different actor-authentication boundary: a room
event identifies its sender, but the event does not contain an OpenID proof
for that sender. The bot's configured Matrix client authenticates as the bot
account and can request an OpenID token for that account. It cannot use that
credential to prove the identity of `event.sender`.

The development Radicale deployment uses the `radicale_auth_matrix` backend
and `owner_only` rights (`dev/compose.yaml`). With one bot principal, those
rights apply to the bot principal's whole calendar home. A room-to-calendar
mapping enforced by the gateway therefore provides application-level scoping;
it does not create a Radicale permission boundary between rooms.

The project needs both the user-owned calendar behavior of the widget and a
safe fallback for room-owned team calendars. It must not infer a CalDAV
principal from a Matrix sender ID, request or handle Matrix passwords, or
expose the bot's broader CalDAV access to room members.

## Decision

Select the CalDAV principal from the explicit, server-authoritative calendar
target, independently of which channel made the request:

1. **Personal widget targets use the validated user's principal.** The gateway
   validates the user's Matrix OpenID proof and delegates that same identity
   to Radicale under ADR006 and ADR009. This remains the widget path for the
   user's personal calendars.
2. **Room-bound widget targets use the bot service principal.** The
   gateway still validates the widget user's OpenID proof as the request
   actor, but uses the bot service principal for CalDAV access to the
   explicitly bound app-owned room calendar. The user's proof is not
   substituted for the bot service principal's CalDAV credential, and that
   principal's token or credentials never reach the browser.
3. **Bot fallback commands use the same service principal.** The server obtains
   a short-lived Matrix OpenID token for the bot itself using its
   authenticated Matrix client. The CalDAV identity is the bot service
   principal, never the command sender. This is the narrow room-target
   extension to ADR009; its per-user credential contract remains unchanged
   for personal targets. The room path requires the OpenID-capable Radicale
   auth module tracked by M2 issue #48 and selected in ADR024; it must not
   substitute a Matrix password.
4. **Authorize the actor and resolve the target before CalDAV.** For every
   room-bound widget or bot operation, validate the caller identity (widget
   OpenID or an event received over the authenticated homeserver connection),
   verify current room membership, check action-specific power, and resolve
   the explicit server-authoritative room-to-calendar binding before any
   CalDAV discovery, read, or write. Missing or ambiguous identity,
   membership, permission, or binding fails closed. Do not use sender IDs as
   CalDAV identities, discover the bot home to choose a target, or allow a
   client to select an unbound collection.
5. **Keep actor and CalDAV principal distinct in policy and audit data.**
   Authorization is evaluated for the validated request actor; the target
   binding selects the Radicale principal. Audit records may identify the
   actor and bound room/calendar, but must not contain credentials, tokens,
   OpenID assertions, or full command/event content.
6. **Treat the bot service principal's Radicale home as one trust domain.** Under
   `owner_only`, the bot principal can access its whole home. Only app-owned
   room calendars may be placed there. Do not place user-owned or unrelated
   private calendars in that home, and do not treat the gateway's room
   mapping as backend isolation. Before operating across mutually untrusted
   rooms, deployment must provide and validate adequate isolation, such as
   separate service-principal homes or a Radicale authorization policy with
   equivalent per-room enforcement. If that isolation is absent, constrain
   the bot principal's home to a single trusted organizational boundary.
7. **Keep secrets out of chat and logs.** Never ask for, store, proxy, log,
   or derive a user's Matrix password. Never put the bot access token, an
   OpenID token/assertion, or CalDAV credentials in room messages or logs.
   Keep the bot access token in server-side secret configuration. Obtain
   short-lived bot-principal OpenID credentials only for the authorized
   operation, and do not persist, cache, or log them, consistent with ADR009's
   credential hygiene.
8. **Defer per-user bot targets.** A bot command must not act on a user's
   personal calendar based only on `event.sender`. Add that capability only
   after a trusted actor-proof mechanism can bind the command to the sender
   and the gateway has explicit authorization for the target calendar. That
   mechanism may not use the bot's own OpenID token as proof of the sender.

Room-bound widget access and M7 data commands depend on the M2 OpenID-capable
Radicale support selected by ADR024 and final delegation contract (#48 and
#45), plus the M6 room-to-calendar binding and server-side actor, membership,
and power checks.
This ADR defines the identity and ownership boundary; it does not implement
commands, bindings, or the Radicale auth module.

## Consequences

- Widget users continue to access personal calendars through their own
  validated Matrix identity. For an explicitly bound room-calendar target,
  the gateway uses that validated user as actor and the app-owned room
  principal for CalDAV access.
- Bot fallback commands use the same app-owned room principal and cannot
  impersonate the sender.
- Room-to-calendar binding and authorization must be resolved before CalDAV
  access. These become prerequisites for M7 data commands.
- The current `owner_only` deployment gives the bot principal whole-home
  access. Gateway checks limit ordinary command behavior but do not contain a
  compromised bot or server to one room. Deployment isolation remains a
  security requirement for multiple trust domains.
- Per-user command targets remain unavailable until trusted actor proof and
  target-calendar authorization are designed and implemented.
- ADR024 selects a clean-room Radicale auth module in this repository and
  does not change the external plugin's source or license. Password-
  authenticated CalDAV clients retain ADR009's compatibility path.

## Acceptance gates for room-bound widget and bot access

- For personal widget targets, the CalDAV OpenID credential identifies the
  validated user. For room-bound widget or bot targets, it identifies the
  bot service principal, and the Basic Auth username matches that identity;
  widget actor validation remains separate from CalDAV principal selection.
- Widget clients never receive the bot service principal's tokens or CalDAV
  credentials.
- Caller identity, membership, action-specific power, and explicit room
  binding are checked before CalDAV discovery, read, or write.
- Non-members, insufficient-power senders, missing bindings, and cross-room
  collection requests are denied before CalDAV discovery or access.
- The command path never uses sender IDs to select or impersonate a CalDAV
  principal.
- Tests and logs demonstrate that Matrix passwords, access tokens, OpenID
  assertions, CalDAV credentials, and full event/command bodies are not
  disclosed.
- The deployed Radicale configuration isolates the bot's whole-home access to
  the intended app-owned trust domain.
