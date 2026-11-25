# Security threat model

[Documentation](./README.md) · [Architecture](./ARCHITECTURE.md) · [Security policy](../SECURITY.md)

**On this page**

- [Scope and status](#scope-and-status)
- [Assets and actors](#assets-and-actors)
- [Trust boundaries and current controls](#trust-boundaries-and-current-controls)
- [Threats, evidence, and residual work](#threats-evidence-and-residual-work)
- [Deferred security gates](#deferred-security-gates)

## Scope and status

This model describes the implemented trust boundaries reviewed against `main`
commit `817854b` on 2026-10-21, including public calendar feeds. It is a source
review, not a penetration test or target-deployment acceptance. The
[release ledger](./RELEASE.md) binds actual validation results to their tested
source; the frozen pilot candidate predates some behavior described here.

Personal widget operations validate Matrix OpenID identity and access Radicale
as that user. Room operations separately check current membership, action
power, and the exact static or ready dynamic room/calendar binding before
using the configured room principal. That principal is selected process-wide:
`appservice` by default, or the normal `bot-account` under ADR041. Radicale's
`owner_only` rights cover its whole home; gateway bindings provide application
scoping, not backend per-room isolation.

Room reads, event writes, moderator setup, reminder configuration, scheduled
delivery, and post-success action notices each have separate default-off
gates. Scheduled reminders use whole-room mentions and refuse encrypted or
unknown room state. Command replies and action notices use the SDK's
crypto-aware path where supported. Public calendar feeds introduce a separate,
explicitly opted-in anonymous read boundary described below; they do not make
private calendar operations anonymous.

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
- **Application databases and backups:** the binding store holds room/calendar
  mappings and setup state; the reminder store holds
  room/calendar/event/alarm identities and delivery claims, not event titles
  or bodies. They use independent schemas and connection settings. Operators
  own backup and retention.
- **Public feed links and signing key:** a link is a bearer capability for the
  entire published VEVENT calendar. The native share database and the dedicated
  gateway signing key must be recovered together.
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
([AppContainer.tsx](../matrix-calendar-widget/src/AppContainer.tsx)).
The inspected widget path contains no local/session storage for these
credentials. The middleware verifies the proof through the configured
homeserver's user-info endpoint, checks the returned Matrix server name
against the assertion, and keeps the proof in the request context
([MatrixAuthMiddleware.ts](../matrix-calendar-server/src/middleware/MatrixAuthMiddleware.ts)).
The middleware also accepts `Bearer` credentials through `whoAmI` for legacy
routes
([MatrixAuthMiddleware.ts](../matrix-calendar-server/src/middleware/MatrixAuthMiddleware.ts)),
so the whole server is not OpenID-only. See
[middleware tests](../matrix-calendar-server/test/middleware/MatrixAuthMiddleware.test.ts).

### Gateway to Matrix homeserver

The gateway uses `HOMESERVER_URL` for Matrix Client-Server requests and as the
default origin for OpenID userinfo verification. Operators may set
`MATRIX_OPENID_USERINFO_URL` to a fixed origin for that verification request
only; the setting rejects paths, queries, fragments, and credentials, and
permits HTTP only on loopback
([configuration.ts](../matrix-calendar-server/src/configuration.ts)). The
Matrix userinfo path is fixed in the gateway, and request fields cannot select
the verification origin. Userinfo requests carry the short-lived
`access_token` in the query string and refuse redirects
([MatrixAuthMiddleware.ts](../matrix-calendar-server/src/middleware/MatrixAuthMiddleware.ts)).
Apply query-token redaction to the verification origin's logs and every proxy
or access-log boundary on that route. Membership and power lookups use the
server's Matrix client.

### Gateway to personal CalDAV

`MatrixOpenIdCalDavCredentialProvider` builds a tagged `matrix-openid:` proof
inside a Basic Authorization header from the validated request context
([credential construction](../matrix-calendar-server/src/caldav/MatrixOpenIdCalDavCredentialProvider.ts)).
`CalDavEventClient` obtains those headers from the provider and attaches them
to the request ([CalDavEventClient.ts](../matrix-calendar-server/src/caldav/CalDavEventClient.ts)).
Missing proof fails closed. A real-container contract covers same-user
enumeration and denial of invalid identities and nonmembers before CalDAV I/O.
See
[PersonalOpenIdRadicaleContract.test.ts](../matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts).

### Gateway to room-owned CalDAV

Room-target operations check current actor membership, action-specific power,
the exact binding from the shared registry, and any requested calendar before
creating the selected room-principal access. Read and write capabilities have
independent default-off settings: `ROOM_CALENDAR_ACCESS_ENABLED` and
`ROOM_CALENDAR_EVENT_WRITES_ENABLED`. The write flag cannot enable room reads.
ADR043 adds default-off moderator setup; ready dynamic bindings use the same
registry and do not bypass either access gate.
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
requires the explicit `trusted-private-network` mode. The independently
configured binding store uses the same TLS policy under
`MATRIX_CALENDAR_BINDING_DATABASE_URL` and its own schema. Configured stores
run migrations and reject unsupported future schema versions on startup.
The bounded scheduler and native sender also require
`ROOM_CALENDAR_ACCESS_ENABLED`, a valid binding and service configuration, and
the default-off `ROOM_CALENDAR_REMINDER_DELIVERY_ENABLED` gate. The separate
settings API gate is `MATRIX_CALENDAR_REMINDER_CONFIGURATION_ENABLED`. Native
scheduled delivery is limited to unencrypted rooms and checks current room
state and mention permission before sending. Source contracts do not establish a production database endpoint's readiness. See [app.module.ts](../matrix-calendar-server/src/app.module.ts),
[ReminderDatabaseConnection.ts](../matrix-calendar-server/src/reminder/ReminderDatabaseConnection.ts),
[ADR019](./adrs/adr019-postgresql-reminder-sidecar-store.md), and
[ADR028](./adrs/adr028-room-reminder-configuration-and-delivery.md).

The project never asks for or stores a user's Matrix password. The browser
does not receive OpenID-backed CalDAV Authorization headers or the selected
room principal's credential. Public-feed links are separately disclosed bearer
capabilities after explicit publication consent.
These boundaries do not protect a token from a compromised widget host or
browser, nor do they make the selected room principal's Radicale home room-scoped.

### Public reader to published calendar

Publication management requires the current personal owner or an authorized
room manager, plus explicit confirmation. The gateway wraps one native
read-only Radicale share in a signed URL and preserves Radicale's share store
as the authority. Every anonymous GET/HEAD fetches and validates the complete
bounded canonical VEVENT feed, rejecting malformed or mixed components,
redirects, unsupported methods, and tampered envelopes. It does not reconstruct
ICS from the widget's partial projection. Requests use fixed deadlines and
size limits plus the process-local gateway limiter; responses are no-store.
See [ADR045](./adrs/adr045-public-calendar-feeds.md),
[publication service](../matrix-calendar-server/src/service/public-feed/PublicCalendarFeedService.ts),
and [public controller](../matrix-calendar-server/src/controller/PublicCalendarFeedController.ts).

A published link remains readable after Matrix membership or manager-power
changes. Unpublishing or native token revocation stops future reads; it cannot
recall client copies. Operators must unpublish before changing a static room
binding. Signed envelopes are not encrypted, so Radicale and its token/sharing
routes must stay private. Proxy logs must redact public bearer paths and
publication queries. Preserve the signing key with the complete Radicale store,
verify revocations after restoring older backups, and use one publication
management writer because its locks are process-local. The source contracts
do not validate a public proxy, external client, or operator recovery.

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

**Current control.** Before selected-principal proof or DAV I/O, the gateway
checks the actor, membership, action power, exact static or ready dynamic
registry binding, and requested calendar. Setup has a separate default-off
gate and must pass its actor, bot, room-state, and widget preconditions before
binding-store or CalDAV work. The room access and write feature gates remain
independently default-off. Pinned real-service contracts exercise allowed
room access and negative cross-room attempts.

**Residual risk and owner.** Radicale `owner_only` still grants the selected room
principal whole-home access. Gateway binding checks are application-level
scoping, not backend isolation. Keep the service-principal home within one
operator-trusted boundary and keep the feature gates off until the target
installation's home contents, proxy, and service identity are accepted.

### Credential leakage through responses or logs

**Current control.** Authentication failures and sensitive transport errors use
fixed or sanitized messages. Pino redacts request Authorization headers and
`matrix_event.content`. Delegated CalDAV headers remain server-side and event
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

**Residual risk and owner.** The adopted [free/busy policy](./free-busy-privacy.md)
and ADR027 define disclosure rules, but no availability endpoint or UI is
implemented. Public feeds deliberately disclose the full selected VEVENT
calendar, not a free/busy view; publication consent must make that distinction
clear. Any future availability surface must satisfy ADR027's authorization,
minimization, and fail-closed projection requirements.

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
before proof or DAV access. Replies use `m.text` with an equivalent plain-text fallback and optional escaped `org.matrix.custom.html`, empty `m.mentions`, and
the SDK's encryption-aware sender; they do not fall back to plaintext when an
encrypted room cannot be confirmed.

Scheduled whole-room reminders remain behind
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

**Residual risk and owner.** Target TLS/CA settings, external log redaction,
network boundaries, secret delivery, and complete recovery require operator
evidence. The bounded pilot uses independent project-owned Radicale storage;
an etke image override or existing `/data` reuse needs additional verification
only if that topology is selected. Repository CI does not establish those
target facts; see [release status](./RELEASE.md).

## Deferred security gates

The following remain open in the implementation plan or require deployment
proof before the stated behavior is available:

- M4/M5: collection-timezone editing and recurrence support beyond the bounded
  implemented slice remain unfinished. PRs #197/#200 support selected-occurrence
  and constrained this-and-following timing edits plus typed EXDATE skip/restore.
  RECURRENCE-ID changes beyond supported timing/text edits, additional RRULE parts, arbitrary rule
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
- M8: applying the free/busy policy in any future surface, qualifying changed
  source in actual clients, screen-reader certification, large-calendar
  capacity, and target ingress/rate controls remain separate work.
- Public feeds: explicit publication consent, private Radicale ingress,
  bearer-path redaction, public-client behavior, and signing-key/share-store
  recovery must be verified for the deployment.
- Production: proxy redaction, external PostgreSQL TLS/CA validation, and
  isolated restore remain operator responsibilities. Existing managed
  Radicale reuse requires its own additional image/data rehearsal.

The hosted browser check is standalone synthetic component evidence. The
pinned Synapse/Radicale contracts are not evidence of an actual Element client,
etke deployment, or production network.

This model is not a penetration test and does not imply live deployment or
beta support. Track milestone completion in [docs/PLAN.md](./PLAN.md) and
deployment blockers in [docs/STATUS.md](./STATUS.md).
