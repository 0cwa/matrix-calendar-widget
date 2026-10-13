# ADR041: Support an optional normal bot account for room operations

- Status: Accepted
- Date: 2026-10-13
- Partially supersedes: only the appservice-specific room-principal and
  reminder-transport clauses in ADR014, ADR024, and ADR028, for deployments
  that explicitly select `bot-account` mode
- Preserves: ADR006, ADR010, ADR015, ADR019, ADR024's OpenID-only Radicale
  authentication and authorization boundaries, ADR028's reminder policy,
  ADR030, and ADR037

## Context

The current room-calendar CalDAV path obtains a short-lived OpenID proof as a
configured application-service user. The room reminder Matrix transport also
uses the application-service token and `user_id` query parameter to act as its
configured sender. The server separately has a normal authenticated Matrix
client account, represented by its client SDK identity and the server-held
`ACCESS_TOKEN`.

A bounded protocol experiment showed that this normal account can request its
own OpenID proof, authenticate to the project's Radicale OpenID module, and
send a room message as itself without an application-service registration.
That experiment did not exercise the gateway's authorization path, reminder
scheduler, PostgreSQL state or recovery, the Element widget, or a managed
homeserver. It is protocol feasibility evidence only.

The current appservice path is already gated and has compatibility value. Any
additional principal choice must remain process-wide and operator-controlled.
It must not turn a widget request, Matrix room sender, or binding into a
principal selector, weaken the existing authorization order, or imply that
Radicale `owner_only` rights are scoped to one room.

## Decision

1. Add the process-only setting `ROOM_CALENDAR_PRINCIPAL_MODE` with exactly
   two values: `appservice` and `bot-account`. An omitted setting selects
   `appservice`, preserving current behavior. Reject every other value during
   configuration validation. No HTTP request, room event, binding, widget
   field, or user ID may select or override the mode.
2. In `appservice` mode, keep the existing configured application-service
   principal, OpenID request, reminder transport, and sender behavior. Do not
   change this compatibility path.
3. In `bot-account` mode, derive the room principal only from the user ID
   returned by the exact already-authenticated Matrix SDK client constructed
   with the same configured `ACCESS_TOKEN`. Do not use a separately configured
   or claimed user ID. The existing `AppRuntimeContext.botUserId` must derive
   from that same SDK client and agree with its `getUserId()` result. Construct
   one immutable, server-side `RoomCalendarPrincipalIdentity` from the
   selected mode and authoritative user ID, and use that same identity as the
   expected CalDAV principal and reminder sender. Keep bearer tokens and
   OpenID proofs in private providers, outside the identity object. If the SDK
   identity is unavailable or disagrees with the runtime context, fail before
   OpenID, CalDAV, or reminder transport requests. For a room CalDAV operation,
   request a short-lived OpenID proof for that exact identity using the same
   server-held token. Fail closed if the identity or proof cannot be
   established. Never substitute a room actor's identity, a configured
   free-form user ID, or an application-service identity. Do not fall back to
   `appservice` if the bot-account path fails.
4. Keep the current actor and target authorization sequence in both modes.
   Authenticate the widget actor or accept the existing authenticated bot
   event context; check current room membership, action-specific power, and
   the exact server-managed binding before OpenID proof issuance or CalDAV
   access. Recheck the binding, selected principal, collection path, and event
   resource at the operation boundary. The widget actor's proof remains
   separate from the room CalDAV principal. Preserve conditional ETag writes,
   stale-write conflicts, unknown iCalendar property preservation, and the
   existing refusal rules for unsafe resources.
5. In `bot-account` mode, reminder state reads and sends use ordinary
   authenticated Matrix Client-Server API requests with the same
   `ACCESS_TOKEN` and the `userId` from the shared
   `RoomCalendarPrincipalIdentity`. Do not accept an independent sender ID or
   send an application-service `user_id` query parameter on any reminder
   state or send request. Revalidate the selected sender's current room
   membership, message power, room-mention power, binding, encryption state,
   and delivery gates as the existing scheduler requires. Keep whole-room
   `m.mentions` delivery and its established message content; do not add
   individual recipients or infer a sender from the request actor.
6. Keep `ROOM_CALENDAR_ACCESS_ENABLED`,
   `ROOM_CALENDAR_EVENT_WRITES_ENABLED`,
   `MATRIX_CALENDAR_REMINDER_CONFIGURATION_ENABLED`,
   `ROOM_CALENDAR_REMINDER_DELIVERY_ENABLED`, and
   `ROOM_CALENDAR_ACTION_MESSAGES_ENABLED` independent and default-off. A
   principal-mode setting does not enable any capability. Reminder delivery
   still requires the application-owned PostgreSQL store and its durable claim
   behavior. Full reminder acceptance still requires PostgreSQL persistence,
   restart, and paired Radicale-plus-PostgreSQL backup/restore evidence.
7. Treat the selected Radicale principal's `owner_only` home as one trust
   domain in either mode. Place only application-owned room calendars in that
   home and constrain it to one trusted organizational boundary unless
   equivalent backend per-room isolation is independently provided and
   validated. Server-managed room bindings continue to scope gateway behavior;
   they are not Radicale ACLs. Do not change ADR037's separate project-owned
   Radicale store or its topology and recovery requirements.
8. Keep the `ACCESS_TOKEN`, application-service token, and short-lived OpenID
   proofs server-side. Do not ask for, store, proxy, log, or derive a Matrix
   password. Do not persist or cache OpenID proofs, place credentials in the
   browser or reminder store, or include credentials, authorization headers,
   or full iCalendar bodies in routine logs or errors. The bot-account mode
   must not use application-service impersonation for reminder REST calls.
9. This decision changes only the selected room-principal mechanism for room
   CalDAV access and reminder providers. Personal calendar identity,
   event semantics, binding management, authorization policy, Radicale
   authentication rules, and deployment topology remain governed by their
   existing decisions. Application-service requirements for unrelated
   application-service features, actions, and notices remain in force when
   those features are enabled. The AS-only wording in ADR014, ADR024, and
   ADR028 is superseded only where it requires the application-service
   identity for a room CalDAV or reminder operation in an explicitly selected
   `bot-account` deployment. All other provisions remain in force.

## Consequences

- Existing deployments retain the application-service behavior unless an
  operator explicitly chooses `bot-account`.
- A deployment that selects `bot-account` can use the normal bot account for
  room CalDAV and reminder API operations without requiring an
  application-service registration for those operations. Failure to prove
  that account's identity disables the operation; it never triggers a
  principal fallback.
- The bot account has whole-home Radicale access under `owner_only`, just as
  the existing service principal does. The trust-domain constraint remains
  necessary.
- Passing the protocol experiment does not establish that the integrated
  gateway, scheduler, reminder database, restore process, Element widget, or
  any operator-managed homeserver supports this mode. Product support and
  deployment readiness require the acceptance gates below.

## Acceptance gates before implementation is considered complete

- Configuration tests prove that an omitted mode keeps `appservice`, each
  explicit value selects only its own path, and invalid values fail closed.
- Principal tests prove that `bot-account` uses the ID returned by the exact
  SDK client constructed with `ACCESS_TOKEN`, that the runtime context agrees,
  and that this shared identity object is used by CalDAV and reminders. A
  mismatched token-owner or unavailable identity must fail before OpenID,
  CalDAV, or reminder transport requests. Self OpenID is requested only after
  actor authorization and cannot be redirected by request input. Existing
  appservice contracts continue to pass unchanged.
- Room event contracts exercise actor authentication, membership, action
  power, exact binding, cross-room denial before proof or CalDAV I/O, the
  shared selected-principal identity, VEVENT preservation, conditional
  create/update/delete, and stale ETag refusal in both modes.
- Reminder tests prove that the bot-account transport uses the selected
  identity and same server token, omits `user_id` query parameters from all
  state and send calls, emits the expected room-wide mention, and retains
  current binding, membership, power, encryption, recheck, bounds, timeout,
  redirect, idempotency, and refusal behavior. Reminder settings and delivery
  remain off by default.
- Real Synapse/Radicale contracts cover the integrated self-OpenID gateway
  path and ordinary reminder sender/readback. PostgreSQL persistence and
  restart tests plus paired fresh-store Radicale/PostgreSQL backup-and-restore
  acceptance pass before full reminder support is claimed.
- Tests and logs demonstrate that no Matrix password, access token, OpenID
  proof, authorization header, or complete iCalendar body is disclosed.

These gates establish only the tested candidate and selected deployment. They
do not by themselves establish Element-client or operator-managed-host
compatibility, beta readiness, or production approval.
