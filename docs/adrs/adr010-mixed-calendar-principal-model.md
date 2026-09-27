# ADR010: Use personal widget calendars and room-owned bot calendars

- Status: Accepted
- Date: 2026-09-27

## Context

The widget supports calendars belonging to an individual Matrix user. The bot
also needs a bounded MVP path for calendars that a room can use, including
actions initiated from the widget. One CalDAV principal for both surfaces
would either blur personal ownership or give room operations unnecessary
access to personal calendars.

ADR006 and ADR009 define the widget-to-gateway identity boundary and the
intended server-side CalDAV delegation contract. They do not establish that a
deployed Radicale authentication plugin can prove an arbitrary Matrix actor to
the bot, nor do they define room-to-calendar ownership. Those facts must not be
assumed from the existence of a Matrix room sender or a configured CalDAV
service principal.

## Decision

Use a mixed principal model with separate personal and room-owned paths:

1. **Personal widget calendars** remain associated with the authenticated
   Matrix user. The gateway validates the widget's Matrix OpenID assertion and
   uses only the corresponding user-scoped server-side CalDAV delegation
   contract for personal operations.
2. **Bot MVP calendars** are owned by the application principal and explicitly
   bound to a Matrix room. The bot uses that principal for room-owned calendar
   operations; it does not create or claim per-user calendars on a user's
   behalf.
3. **Room-principal access is blocked until its CalDAV authentication path is
   defined and tested.** Neither room-owned calendar reads nor writes—whether
   initiated by the bot or a room-scoped widget request—may use the application
   principal until a non-password server-to-Radicale authentication path for
   that principal has been specified and tested. ADR009 defines an intended
   delegated OpenID path for a validated user principal; it does not provide
   credentials or an authentication contract for the application principal.
   This ADR does not presume that Radicale, its auth plugin, or an etke
   deployment supports such a path.
4. **Room-scoped widget operations** may use the application principal only
   after the authentication prerequisite above is met and the gateway has
   independently established all of the following for the request: a
   validated widget OpenID identity, current room membership, the required
   room power under configured policy, and an explicit binding between the
   requested calendar and that room. The gateway must authorize the requested
   operation under that room's policy before performing it.
5. **Bot commands** that read or mutate a room-owned calendar must, for every
   command, validate the sender's current room membership and required power,
   resolve the explicit room-to-calendar binding, and authorize the requested
   operation under that room's policy. These checks do not satisfy the
   application-principal CalDAV authentication prerequisite above.
6. **Matrix event sender identity is authorization context, not OpenID proof or
   CalDAV identity proof.**
   A sender may be used to resolve room membership/power and to record the
   actor in an audit trail. A sender value alone does not authenticate a
   widget requester, establish that the requester owns a Matrix identity, or
   prove a CalDAV principal. The gateway must validate the widget's OpenID
   assertion separately and must not infer its subject from an event sender.
7. **Per-user bot calendars are deferred.** Do not make the bot create or
   mutate personal calendars until a separately reviewed, tested contract
   establishes a trusted actor-token path that binds the requested Matrix
   actor to the CalDAV operation. ADR009's intended gateway delegation does
   not by itself prove that a bot can impersonate arbitrary users.

## Security invariants

- CalDAV credentials and delegated credentials stay server-side. Never return
  them to the widget, store them in browser persistence, or log them.
- Every widget request is authenticated from a homeserver-validated OpenID
  assertion; room membership, power, and binding checks are separate
  authorization checks.
- Every bot command that accesses a room-owned calendar rechecks the sender's
  current membership and required power, and resolves the explicit
  room-to-calendar binding. Sender identity is authorization/audit context,
  never proof of CalDAV identity.
- Room-principal reads and writes remain disabled until a non-password
  server-to-Radicale authentication path for the application principal is
  defined and tested. ADR009's user-delegation contract does not satisfy this
  prerequisite.
- The room-to-calendar binding is explicit server-side state. A caller cannot
  select an unbound room calendar by supplying a calendar ID alone.
- Application-principal access is limited to the room-owned calendar selected
  by the validated room binding and the authorized operation. It must not
  silently become access to a user's personal calendar.
- Audit records may associate the validated OpenID subject, room, operation,
  and relevant Matrix sender context, but must not contain credentials or
  event contents beyond what the audit policy explicitly permits.
- A Matrix sender, room ID, or client-supplied user ID is not a substitute for
  validating the widget's OpenID assertion.

## Alternatives considered

### Use only per-user principals

This preserves personal ownership but leaves the bot without a safe MVP path
for room-owned calendars unless a trusted actor-delegation mechanism is
available. That mechanism is not established.

### Use only the application principal

This simplifies bot access but collapses personal and room ownership and
creates an unnecessarily broad authorization boundary for personal widget
calendars.

### Let the bot act as the Matrix event sender

A sender identifies a room-event origin for room authorization and auditing;
it does not prove that a widget request has a valid OpenID identity or that a
CalDAV plugin can safely act as that user. This option would conflate distinct
proofs and is rejected.

## Consequences

- The application principal and room-calendar binding require explicit server
  configuration and lifecycle handling.
- Room-scoped widget endpoints must perform membership, power, and binding
  checks on every authorized operation; UI visibility is not an authorization
  boundary.
- Personal widget operations and room-owned bot operations remain distinct
  even if they share one gateway deployment.
- The first bot MVP does not provide per-user calendar ownership or
  impersonation. Reconsider that capability only after the actor-token
  contract is available and tested independently.
- This decision defines the application's principal and authorization model;
  it makes no claim about capabilities or guarantees of any upstream or etke
  Radicale plugin or deployment.
