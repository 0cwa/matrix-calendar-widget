# ADR014: Separate widget and bot calendar principals

- Status: Accepted
- Date: 2026-09-26

## Context

ADR006 and ADR009 establish per-user Matrix OpenID delegation for widget
requests. The gateway validates a user's OpenID proof and delegates that same
identity to Radicale. A Matrix bot command has a different trust boundary: a
room event identifies its sender, but the event does not contain an OpenID
proof for that sender. The bot's configured Matrix client authenticates as the
bot account and can request an OpenID token for that account. It cannot use
that credential to prove the identity of `event.sender`.

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

Keep the widget and bot command paths on separate calendar principals:

1. **Widget requests remain per-user.** The gateway validates the user's
   Matrix OpenID proof and delegates that same user identity to Radicale under
   ADR006 and ADR009.
2. **Bot fallback commands use an app-owned room-calendar principal.** The
   server obtains a short-lived Matrix OpenID token for the bot itself using
   the bot's authenticated Matrix client. The CalDAV identity is that bot
   account, never the command sender. The bot path must use the OpenID-capable
   Radicale plugin tracked by M2 issue #48; it must not substitute a Matrix
   password.
3. **The room sender remains the authorization actor.** Before any CalDAV
   discovery, read, or write, the server validates that the sender is a room
   member and has the action-specific permission, then resolves an explicit,
   server-authoritative room-to-calendar binding. Missing or ambiguous
   membership, permission, or binding fails closed. A command must not discover
   the bot's home and let the sender choose an arbitrary collection.
4. **Keep actor and CalDAV principal distinct in policy and audit data.**
   Authorization is evaluated for the validated room sender; Radicale access
   is performed as the bot service principal. Audit records may identify the
   actor and the bound room/calendar, but must not contain credentials,
   tokens, OpenID assertions, or full command/event content.
5. **Treat the bot's Radicale home as one trust domain.** Under `owner_only`,
   the bot can access its whole home. Only app-owned room calendars may be
   placed there. Do not place user-owned or unrelated private calendars in
   that home, and do not treat the gateway's room mapping as backend
   isolation. Before operating across mutually untrusted rooms, deployment
   must provide and validate adequate isolation, such as separate service
   principals/homes or a Radicale authorization policy with equivalent
   per-room enforcement. If that isolation is absent, the deployment must
   constrain the bot home to a single trusted organizational boundary.
6. **Keep secrets out of chat and logs.** Never ask for, store, proxy, log, or
   derive a user's Matrix password. Never put the bot access token, an OpenID
   token/assertion, or CalDAV credentials in room messages or logs. Keep the
   bot access token in server-side secret configuration. Obtain short-lived
   bot OpenID credentials only for the authorized operation, and do not
   persist, cache, or log them, consistent with ADR009's credential hygiene.
7. **Defer per-user bot targets.** A bot command must not act on a user's
   personal calendar based only on `event.sender`. Add that capability only
   after a trusted actor-proof mechanism can bind the command to the sender
   and the gateway has explicit authorization for the target calendar. That
   mechanism may not use the bot's own OpenID token as proof of the sender.

M7 data commands depend on the M2 OpenID-capable Radicale support and final
delegation contract (#48 and #45), plus the M6 room-to-calendar binding and
server-side membership/power checks. This ADR defines the identity and
ownership boundary; it does not implement commands, bindings, or the external
Radicale plugin.

## Consequences

- Widget users continue to access their own calendars through their own
  validated Matrix identity.
- Bot fallback commands can operate on explicitly bound, app-owned room
  calendars without impersonating the sender.
- Room-to-calendar binding and authorization must be resolved before CalDAV
  access. These become prerequisites for M7 data commands.
- The current `owner_only` deployment gives the bot principal whole-home
  access. Gateway checks limit ordinary command behavior but do not contain a
  compromised bot or server to one room. Deployment isolation remains a
  security requirement for multiple trust domains.
- Per-user command targets remain unavailable until trusted actor proof and
  target-calendar authorization are designed and implemented.
- The OpenID plugin change remains external to this repository under its own
  license. Password-authenticated CalDAV clients retain ADR009's existing
  compatibility path.

## Acceptance gates for M7 data commands

- The OpenID credential presented to Radicale identifies the bot account, and
  the Basic Auth username matches that identity.
- Non-members, insufficient-power senders, missing bindings, and cross-room
  collection requests are denied before CalDAV discovery or access.
- The command path never uses sender IDs to select or impersonate a CalDAV
  principal.
- Tests and logs demonstrate that Matrix passwords, access tokens, OpenID
  assertions, CalDAV credentials, and full event/command bodies are not
  disclosed.
- The deployed Radicale configuration isolates the bot's whole-home access to
  the intended app-owned trust domain.
