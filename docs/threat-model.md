# Security threat model

## Scope and status

This source-based model records the repository boundary at `main` commit
`f49acee71280944ad6ae351111947ff01c00031d` on 2026-10-03. It is not a
penetration test, a deployment approval, or evidence that an operator-hosted
service has the same configuration.

The personal widget path validates Matrix OpenID identity and accesses
Radicale as that user. Room-owned calendar reads (#164) and event mutations
(#193) use the configured application-service principal after current actor,
membership, action-power, and exact room/calendar-binding checks. PR #201
connects the primary widget to the room capabilities and the one authorized
bound calendar; its detail view displays a safe link to the current Matrix
room, and authorized managers can configure supported alarm reminders. Read
and write features are separately default-off. The service principal's
Radicale `owner_only` access spans its whole home; room bindings provide
application scoping, not backend per-room ACLs. Pinned Synapse/Radicale and
widget contracts cover these repository paths, not an etke-managed host or
production deployment.

The fallback bot has bounded room-calendar data commands (#196); its process-
local traffic limiter (#198) denies excess commands before Matrix state or
CalDAV work. Command replies use the SDK's encryption-aware send path and fail
closed when encrypted-room state cannot be confirmed. PR #199 wires separately
gated reminder configuration and delivery plus best-effort notices after
room-target widget event create/update/delete. Scheduled reminders use a native
appservice sender and are refused for encrypted or unknown room state;
room-target widget action notices use the SDK crypto-aware path and send only
after successful room-target widget create/update/delete operations. Neither
path is enabled by default. The actual etke image override, `/data` continuity, proxy logging, and
production PostgreSQL connection remain unverified.

## Assets and actors

- **CalDAV collections and VEVENTs:** titles, descriptions, times, locations,
  attendee identities, meeting URLs, recurrence, alarms, and resource metadata
  can reveal private plans and relationships. Radicale is canonical.
- **Matrix identity assertions and access tokens:** OpenID proofs and Matrix
  bearer tokens authenticate users. The bot `ACCESS_TOKEN` and configured
  appservice token can act with server-side authority.
- **CalDAV authorization headers:** the tagged OpenID proof is carried in a
  server-generated Basic Authorization header. A leaked header can be replayed
  while its proof remains valid.
- **Room/calendar bindings and service-principal home:** bindings choose the
  app-owned room collection. Radicale `owner_only` grants the service
  principal access to its whole home, not to one room.
- **Reminder database and backups:** when enabled, PostgreSQL holds
  room/calendar/event/alarm identities and delivery claims, not event titles
  or bodies. Operators own backup and retention.
- **Logs and deployment configuration:** logs, environment secrets, proxy
  settings, and persistent volumes can expose credentials or calendar data or
  change which service receives them.

Relevant actors include a legitimate widget user, a nonmember or lower-power
room member, a malicious authenticated user, an external CalDAV client that
can write calendar resources, the configured Matrix homeserver and Radicale
service, and operators or attackers with access to the gateway host or its
logs. Room event text and iCalendar values are input data; a sender string or
event body is not an identity proof.

## Trust boundaries and current controls

### Widget to gateway

The widget obtains OpenID credentials through the Matrix Widget API for a
gateway request and sends an `MX-Identity` Authorization header
([AppContainer.tsx#L98-L114](../matrix-calendar-widget/src/AppContainer.tsx#L98-L114)).
The inspected widget path contains no local/session storage for these
credentials. The middleware verifies the proof through the configured
homeserver's user-info endpoint, checks the returned Matrix server name
against the assertion, and keeps the proof in the request context
([MatrixAuthMiddleware.ts#L77-L96](../matrix-calendar-server/src/middleware/MatrixAuthMiddleware.ts#L77-L96),
[verification at #L121-L159](../matrix-calendar-server/src/middleware/MatrixAuthMiddleware.ts#L121-L159)).
The middleware also accepts `Bearer` credentials through `whoAmI` for legacy
routes
([MatrixAuthMiddleware.ts#L99-L101](../matrix-calendar-server/src/middleware/MatrixAuthMiddleware.ts#L99-L101)),
so the whole server is not OpenID-only. See
[middleware tests](../matrix-calendar-server/test/middleware/MatrixAuthMiddleware.test.ts).

### Gateway to Matrix homeserver

The gateway selects `HOMESERVER_URL` from server configuration; a request
cannot choose the verification host
([configuration.ts](../matrix-calendar-server/src/configuration.ts)). OpenID
user-info requests put the short-lived `access_token` in the query string,
then call `fetch` without a caller-selected origin
([MatrixAuthMiddleware.ts#L133-L154](../matrix-calendar-server/src/middleware/MatrixAuthMiddleware.ts#L133-L154)).
Membership and power lookups use the server's Matrix client.

### Gateway to personal CalDAV

`MatrixOpenIdCalDavCredentialProvider` builds a tagged `matrix-openid:` proof
inside a Basic Authorization header from the validated request context
([credential construction at #L49-L63](../matrix-calendar-server/src/caldav/MatrixOpenIdCalDavCredentialProvider.ts#L49-L63)).
`CalDavEventClient` obtains those headers from the provider and attaches them
to the request ([header construction at #L259-L261](../matrix-calendar-server/src/caldav/CalDavEventClient.ts#L259-L261),
[REPORT request at #L95-L103](../matrix-calendar-server/src/caldav/CalDavEventClient.ts#L95-L103)).
Missing proof fails closed. A real-container contract covers same-user
enumeration and denial of invalid identities and nonmembers before CalDAV I/O.
See
[PersonalOpenIdRadicaleContract.test.ts](../matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts).

### Gateway to room-owned CalDAV

Room-target operations check current actor membership, action-specific power,
the exact configured room/calendar binding, and any requested calendar before
creating appservice access. Read and write capabilities have independent
default-off settings: `ROOM_CALENDAR_ACCESS_ENABLED` and
`ROOM_CALENDAR_EVENT_WRITES_ENABLED`. The write flag cannot enable room reads.
The pinned Synapse/Radicale room contract exercises reads and event mutations,
including cross-room and nonmember denial before proof or CalDAV I/O. See
[CalendarGatewayController.ts](../matrix-calendar-server/src/controller/CalendarGatewayController.ts),
[MatrixCalendarAuthorization.ts](../matrix-calendar-server/src/service/MatrixCalendarAuthorization.ts),
[RoomCalendarEventOperations.ts](../matrix-calendar-server/src/service/RoomCalendarEventOperations.ts),
and [RoomAppServiceRadicaleContract.test.ts](../matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts).

The room-target path is distinct from user-principal room-context routes, which
continue to use the authenticated user's CalDAV identity.

### Gateway to optional PostgreSQL

Reminder persistence is disabled when `MATRIX_CALENDAR_REMINDER_DATABASE_URL`
is absent. If configured, the store uses verified TLS by default; plaintext
requires the explicit `trusted-private-network` mode. PR #199 wires the
bounded scheduler and native sender, but delivery also requires
`ROOM_CALENDAR_ACCESS_ENABLED`, a valid binding and service configuration, and
the default-off `ROOM_CALENDAR_REMINDER_DELIVERY_ENABLED` gate. The separate
settings API gate is `MATRIX_CALENDAR_REMINDER_CONFIGURATION_ENABLED`. Native
scheduled delivery is limited to unencrypted rooms and checks current room
state and mention permission before sending. No production database endpoint
has been tested. See [app.module.ts](../matrix-calendar-server/src/app.module.ts),
[ReminderDatabaseConnection.ts](../matrix-calendar-server/src/reminder/ReminderDatabaseConnection.ts),
[ADR019](./adrs/adr019-postgresql-reminder-sidecar-store.md), and
[ADR028](./adrs/adr028-room-reminder-configuration-and-delivery.md).

The project never asks for or stores a user's Matrix password. The browser
does not receive CalDAV credentials or the bot service principal's credential.
These boundaries do not protect a token from a compromised widget host or
browser, nor do they make the appservice principal's Radicale home room-scoped.

## Threats, evidence, and residual work

### Forged identity, token substitution, or unauthorized calendar access

**Current control.** The gateway verifies the request proof against its
configured homeserver. The personal CalDAV adapter requires that proof. Room
membership and action-specific power are checked server-side and fail closed
on lookup failure. The binding parser rejects malformed, duplicate, missing,
or mismatched room/calendar mappings. See the middleware,
[authorization tests](../matrix-calendar-server/src/service/MatrixCalendarAuthorization.test.ts),
[binding tests](../matrix-calendar-server/src/service/RoomCalendarBindingResolver.test.ts),
and [gateway membership contract](../matrix-calendar-server/test/CalendarGatewayMembershipGuard.test.ts).

**Residual risk and owner.** A valid proof is a bearer secret until expiry;
theft from the browser, gateway process, or infrastructure can enable replay.
The legacy `Bearer` branch and inherited meeting endpoints need their own
scope review. Keep the proof request-scoped and repeat identity, membership,
and power checks for each operation.

### Cross-room access through the service principal

**Current control.** Before application-service proof or DAV I/O, the gateway
checks the actor, membership, action power, exact `ROOM_CALENDAR_BINDINGS`
entry, and requested calendar. The room access and write feature gates remain
independently disabled by default. Pinned real-service contracts exercise
allowed room access and negative cross-room attempts.

**Residual risk and owner.** Radicale `owner_only` still grants the appservice
principal whole-home access. Gateway binding checks are application-level
scoping, not backend isolation. Keep the service-principal home within one
operator-trusted boundary and keep the feature gates off until the target
installation's home contents, proxy, and service identity are accepted.

### Credential leakage through responses or logs

**Current control.** Authentication failures and sensitive transport errors use
fixed or sanitized messages. Pino redacts request Authorization headers and
`matrix_event.content`. OpenID proofs stay server-side and CalDAV event
transports refuse redirects, so credentials are not forwarded through a
redirect response. The pinned personal OpenID contract checks that proofs are
absent from gateway responses and inspected test-service logs. See
[MatrixAuthMiddleware tests](../matrix-calendar-server/test/middleware/MatrixAuthMiddleware.test.ts),
[PersonalOpenIdRadicaleContract.test.ts](../matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts),
and [app.module.ts](../matrix-calendar-server/src/app.module.ts).

**Residual risk and owner.** OpenID validation calls the configured homeserver
with an `access_token` query parameter. The repository contract does not verify
the operator's Synapse, reverse-proxy, or other production access-log
configuration. The operator must configure query redaction and run a sentinel-
token test across the deployed gateway, homeserver, Radicale, and reverse proxy
before enabling room access.

### Server-side requests reach an unintended host (SSRF or credential forwarding)

**Current control.** Discovery hrefs are validated against the configured
Radicale origin and base path before follow-up requests; discovery requests use
manual redirect handling and reject redirects. Event requests also reject
redirects and cap streamed response bytes (16 MiB by default, configurable up
to 64 MiB). Room event operations constrain resource URLs to a child of the
exact authorized collection. These controls prevent an untrusted DAV response
or redirect from sending delegated credentials to a different host. See
[CalDavDiscoveryClient.ts](../matrix-calendar-server/src/caldav/CalDavDiscoveryClient.ts),
[CalDavEventClient.ts](../matrix-calendar-server/src/caldav/CalDavEventClient.ts),
and [RoomCalendarEventOperations.ts](../matrix-calendar-server/src/service/RoomCalendarEventOperations.ts).

**Residual risk and owner.** The configured homeserver and Radicale endpoints
remain trusted peers. Review their DNS, TLS, network egress, and proxy paths in
the target deployment. Source-level origin and path checks do not verify those
operator-controlled networks.

### Malformed or large iCalendar data consumes resources or changes visible content

**Current control.** The projector caps occurrences at 512 per event, RRULE
scanning at 100,000 steps, and recurrence input members at 4,096. Unsupported
recurrence/timezone inputs produce count-and-reason diagnostics without event
details. CalDAV event REPORT/GET responses are streamed under the configured
byte cap; discovery XML is separately bounded. Express JSON and urlencoded
request bodies are limited to 100 KiB. The widget renders event text as React
text; supported HTTP(S), ATTACH, and CONFERENCE links are bounded and
revalidated before rendering as anchors, with no preview or fetch.

**Residual risk and owner.** These caps bound individual inputs and projected
work; they are not a production capacity guarantee. PR #184's projection
benchmark is synthetic. Large calendars, concurrent workloads, and behavior
against the operator's actual Radicale version still require acceptance tests.
The response and request caps do not define upstream proxy limits.

### Calendar details or availability are exposed too broadly

**Current control.** The product treats titles, attendees, locations,
descriptions, and free/busy data as sensitive. Room-context reads require
current membership; diagnostics require manager power. The current calendar
API returns full supported event details for matching resources, not a
free/busy projection.

**Residual risk and owner.** The M8 free/busy privacy model is open; no
user-facing free/busy surface was established in this slice. Product/security
owners must define disclosure rules before adding availability endpoints or
sharing calendar data across trust boundaries.

### API abuse or reminder mention spam

**Current control.** The calendar HTTP limiter runs before OpenID validation.
It allows 120 requests per fixed 60-second window per TCP peer by default, caps
its in-memory map at 10,000 keys, ignores forwarded-address headers, and emits
a generic 429 with `Retry-After`. Cleanup is bounded. The bot command limiter
accepts only a bounded number of `!calendar` commands per room/sender and
process: at most six per room/sender per rolling minute, one in flight per
room/sender, two per room, and eight process-wide. Its key table is capped at
1,000 entries. Denials are silent and retain no command text or logs. Legacy
`!meeting` commands do not use this limiter. See
[CalendarGatewayRateLimitMiddleware.ts](../matrix-calendar-server/src/middleware/CalendarGatewayRateLimitMiddleware.ts)
and [CalendarCommandTrafficLimiter.ts](../matrix-calendar-server/src/service/CalendarCommandTrafficLimiter.ts).

Room commands also require current membership, action power, and exact binding
before proof or DAV access. Replies use plain `m.text`, empty `m.mentions`, and
the SDK's encryption-aware sender; they do not fall back to plaintext when an
encrypted room cannot be confirmed.

PR #199 wires scheduled whole-room reminders behind
`ROOM_CALENDAR_REMINDER_DELIVERY_ENABLED`. The bounded scheduler rechecks the
current binding, canonical event/alarm, encryption state, and room-mention
power before sending; its native transport refuses encrypted or unknown room
state. Stable Matrix transaction IDs and PostgreSQL claims support retry
coordination but do not guarantee exactly-once delivery. The scheduler assumes
a single service replica; its limits are not a distributed quota or production
capacity proof.

Room-target widget create/update/delete notices are separately gated by
`ROOM_CALENDAR_ACTION_MESSAGES_ENABLED`. They run only after a successful
CalDAV create/update/delete, contain a sanitized title and opaque resource ID,
and set empty `m.mentions`. The service rechecks binding and bot membership/
power; it skips encrypted rooms unless the SDK confirms crypto is active. A
notice failure never rolls back a committed CalDAV mutation. The Matrix bot SDK request timeout for these notices is 60 seconds by default
and is not overridden here; scheduled reminders use a separate native
transport with a two-second request timeout. Neither
notice behavior nor scheduled delivery is enabled by default, and native
scheduled reminders do not support encrypted rooms.

**Residual risk and owner.** Both limiters are process-local, reset on restart,
and enforce independent limits per replica. The calendar HTTP limiter sees
only `socket.remoteAddress`; behind a reverse proxy its callers share one
quota. Use one server replica or add an appropriate trusted upstream or
distributed control. The HTTP gateway bootstrap enables CORS without a
repository-configured origin allowlist; the operator must verify ingress and
proxy policy.

### Deployment, backup, or database configuration exposes secrets or data

**Current control.** Reminder database transport defaults to verified TLS,
and deployment docs describe cold backups for project-owned volumes.

**Residual risk and owner.** The etke image override, existing `/data`
continuity, live TLS/CA settings, external log redaction, network boundaries,
secret delivery, and restore path have not been rehearsed on the operator host.
The operator owns those checks; repository CI is not deployment evidence.

## Deferred security gates

The following remain open in the implementation plan or require deployment
proof before the stated behavior is available:

- M4/M5: collection-timezone editing and recurrence support beyond the bounded
  implemented slice remain unfinished. PRs #197/#200 support selected-occurrence
  and constrained this-and-following timing edits plus typed EXDATE skip/restore.
  General RECURRENCE-ID property editing, additional RRULE parts, arbitrary rule
  splitting, and actual client/server interoperability remain open; arbitrary
  RRULE and broader authoring are unsupported.
- M6: the bounded repository scope, including the primary room-calendar
  widget workflow, reminder controls, and action notices, is implemented and
  passed hosted checks. Operator deployment acceptance remains open. Reminder
  configuration, bounded scheduler, native unencrypted-room delivery, and
  room-target action notices are wired behind separate default-off gates.
  Keep room access, writes, configuration, delivery, and notices disabled
  until the operator accepts each capability and the service-principal home
  boundary.
- M8: free/busy disclosure policy, actual-client and screen-reader validation,
  large-calendar capacity, and trusted upstream rate control remain open.
- Production: etke image/data rehearsal, proxy query-log redaction, external
  PostgreSQL TLS/CA validation, and isolated restore rehearsal remain operator
  responsibilities.

The hosted browser check is standalone synthetic component evidence. The
pinned Synapse/Radicale contracts are not evidence of an actual Element client,
etke deployment, or production network.

This model is not a penetration test and does not imply live deployment or
beta support. Track milestone completion in [docs/PLAN.md](./PLAN.md) and
deployment blockers in [docs/STATUS.md](./STATUS.md).
