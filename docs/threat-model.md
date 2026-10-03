# Security threat model

## Scope and status

This source-based model was checked against `main` at
`9afadbe83dd28943dfc88440816528f564081190` on 2026-10-03. It describes the
checked-in pre-alpha system; it is not a penetration test, a deployment
approval, or evidence that an operator-hosted service has the same
configuration. It records existing boundaries and residual risks without
adding a permission rule.

The personal widget path validates a Matrix OpenID assertion and accesses
Radicale as that user. Existing room-context gateway routes also authorize the
current user against Matrix room membership and power, then access that user's
CalDAV principal. They do not use the room service principal. The room-target
path resolves an exact server-configured binding after actor and room checks,
but `RoomCalendarCalDavAccess` still denies before CalDAV I/O. Listing room
calendars returns only a read-only descriptor of the configured calendar ID,
without CalDAV I/O. Room collection lifecycle remains operator-managed.

PR #164 is an unmerged draft read-only `target=room` event-listing candidate
outside this source snapshot. Its real-container contract has not passed.
It does not enable room CalDAV access: the default access
gate remains closed, and room-target event mutations remain unavailable. Its
behavior must not be described as deployed or as proof of cross-room
isolation.

The bot fallback currently provides `!calendar help`; event-query and
data-changing commands remain open. PostgreSQL reminder persistence is
optional. Its scheduling and Matrix delivery helpers are not wired to a
sender or scheduler. The actual etke-managed Radicale image override, `/data`
preservation, proxy logging, and production PostgreSQL connection have not
been verified.

## Assets and actors

- **CalDAV collections and VEVENTs:** titles, descriptions, times, locations,
  attendee identities, meeting URLs, recurrence, alarms, and resource metadata
  can reveal private plans and relationships. Radicale is canonical.
- **Matrix identity assertions and access tokens:** OpenID proofs and Matrix
  bearer tokens authenticate users. The bot `ACCESS_TOKEN` and any future
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

Main validates current membership, action power, and the exact static
room/calendar binding. The access service then returns unavailable without
network or CalDAV I/O. Existing user-principal room-context routes are
separate. See [CalendarGatewayController.ts](../matrix-calendar-server/src/controller/CalendarGatewayController.ts),
[MatrixCalendarAuthorization.ts](../matrix-calendar-server/src/service/MatrixCalendarAuthorization.ts),
[RoomCalendarBindingResolver.ts](../matrix-calendar-server/src/service/RoomCalendarBindingResolver.ts),
[RoomCalendarCalDavAccess.ts](../matrix-calendar-server/src/service/RoomCalendarCalDavAccess.ts),
and
[authorization tests](../matrix-calendar-server/src/service/MatrixCalendarAuthorization.test.ts).

### Gateway to optional PostgreSQL

Reminder persistence is disabled when `MATRIX_CALENDAR_REMINDER_DATABASE_URL`
is absent. If configured, the store uses verified TLS by default; plaintext
requires the explicit `trusted-private-network` mode. The store is persistence
only, not a running reminder sender. No production database endpoint has been
tested. See [app.module.ts](../matrix-calendar-server/src/app.module.ts),
[ReminderDatabaseConnection.ts](../matrix-calendar-server/src/reminder/ReminderDatabaseConnection.ts),
and [ADR019](./adrs/adr019-postgresql-reminder-sidecar-store.md).

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

**Current control.** The main room-target path checks the actor, action power,
exact `ROOM_CALENDAR_BINDINGS` entry, and any requested calendar ID before
reaching a gate that always denies.

**Residual risk and owner.** Radicale `owner_only` still grants the appservice
principal whole-home access. Gateway binding checks are application-level
scoping, not backend isolation. Before enabling room CalDAV, the gateway owner
must validate href confinement and appservice proof ordering; the operator
must prove the service-principal home contains only one trusted boundary or
provide equivalent per-room isolation. Issue #7 needs negative cross-room
tests against real Radicale.

### Credential leakage through responses or logs

**Current control.** Authentication failures log a constant message. Pino
redacts request Authorization headers and `matrix_event.content`. The
personal OpenID contract checks that protected proofs are absent from gateway
responses/logs and inspected Synapse/Radicale test-service logs. See
[MatrixAuthMiddleware tests](../matrix-calendar-server/test/middleware/MatrixAuthMiddleware.test.ts),
[PersonalOpenIdRadicaleContract.test.ts](../matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts),
and [app.module.ts](../matrix-calendar-server/src/app.module.ts).

**Residual risk and owner.** The OpenID token appears in a query parameter
sent to the homeserver. The contract does not verify the operator's Synapse,
Traefik, or other production access-log configuration. The operator must
configure query redaction and run a sentinel-token test across the deployed
gateway, Radicale, homeserver, and reverse proxy before room access is
enabled.

### Server-side requests reach an unintended host (SSRF or credential forwarding)

**Current control.** Caller-supplied calendar and event URLs are constrained
to the configured Radicale origin and base path by `normalizeRadicaleUrl`; a
regression test rejects a caller-supplied URL on another origin
([CalendarGatewayController.ts#L1048-L1086](../matrix-calendar-server/src/controller/CalendarGatewayController.ts#L1048-L1086),
[test at #L1867-L1883](../matrix-calendar-server/src/controller/CalendarGatewayController.test.ts#L1867-L1883)).
Diagnostics additionally filter returned collection URLs
([safe diagnostics URL filtering at #L1147-L1185](../matrix-calendar-server/src/controller/CalendarGatewayController.ts#L1147-L1185)).
The homeserver verification origin comes from `HOMESERVER_URL`, not from the
request.

**Residual risk and owner.** Keep caller-controlled targets distinct from a
compromised or malicious configured peer. `CalDavDiscoveryClient.discoverHome`
resolves `current-user-principal` and `calendar-home-set` hrefs from Radicale
responses at [lines 399–420](../matrix-calendar-server/src/caldav/CalDavDiscoveryClient.ts#L399-L420),
then makes follow-up requests with the delegated Authorization header at
[lines 445–459](../matrix-calendar-server/src/caldav/CalDavDiscoveryClient.ts#L445-L459).
Those response-derived URLs are not checked against the configured origin or
base before the next request. The fetch dependency defaults to global `fetch`
([constructor at #L146-L151](../matrix-calendar-server/src/caldav/CalDavDiscoveryClient.ts#L146-L151));
request calls set no explicit redirect option
([PROPFIND at #L455-L459](../matrix-calendar-server/src/caldav/CalDavDiscoveryClient.ts#L455-L459)).
I found no test asserting a foreign principal/home href or redirect behavior,
so whether a redirect forwards Authorization is unverified here. Gateway
maintainers should add origin/path validation for every discovered href and
tests for foreign `current-user-principal`, `calendar-home-set`, and collection
hrefs plus cross-origin redirects; assert that no credential is sent outside
the configured service.

### Malformed or large iCalendar data consumes resources or changes visible content

**Current control.** The gateway only projects a bounded recurrence subset.
The projector caps results at 512 occurrences per event, RRULE scanning at
100,000 steps, and recurrence input members at 4,096. Unsupported
timezone/recurrence inputs produce count-and-reason diagnostics without event
details. The calendar details view renders title, location, and description
as React text. See [occurrence projection limits](../packages/calendar/src/utils/calendarEventOccurrenceProjection.ts#L43-L49),
[ICalendarEventCodec.ts](../matrix-calendar-server/src/caldav/ICalendarEventCodec.ts),
and [CalendarEventDetailsDialog.tsx](../matrix-calendar-widget/src/components/calendar/CalendarEventDetailsDialog.tsx).

**Residual risk and owner.** These recurrence limits do not cap CalDAV REPORT
bytes, event-resource bytes, or total returned resources.
`CalDavEventClient.listEvents` materializes the full response text and every
returned resource before projection
([transport at #L109-L139](../matrix-calendar-server/src/caldav/CalDavEventClient.ts#L109-L139),
[gateway parsing at #L583-L594](../matrix-calendar-server/src/controller/CalendarGatewayController.ts#L583-L594)).
No gateway rate limiter or explicit request/response byte limits were found in
these paths; rate limits and large-calendar performance are open M8 work
([implementation plan at #L368-L384](./PLAN.md#L368-L384)). Security and
performance owners should define limits and add oversized-response and
recurrence-abuse tests. A safe URL-scheme policy for any future clickable
iCalendar URL field also remains to be reviewed; the event `URL` property is
currently preserved as calendar data.

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

**Current control.** Room membership and power are checked for the current
gateway operations. Reminder store identities and lease claims have database
constraints. `m.mentions` policy helpers check scheduling and delivery
conditions in unit tests.

**Residual risk and owner.** No route rate limiter is configured in the
inspected gateway, and bootstrap sets `cors: true` without a repository-
configured origin allowlist ([index.ts#L35-L41](../matrix-calendar-server/src/index.ts#L35-L41)).
Room event text is untrusted input; a sender string or event body does not
establish OpenID identity. The `m.mentions` scheduling/delivery policy is
covered by helper tests but is not wired to a scheduler or sender
([RoomMentionPolicy.ts](../matrix-calendar-server/src/reminder/RoomMentionPolicy.ts),
[RoomMentionPolicy.test.ts](../matrix-calendar-server/src/reminder/RoomMentionPolicy.test.ts)).
It therefore provides no live delivery protection. M8 rate limits/abuse
controls and reminder delivery acceptance remain open; service owners should
add request limits and keep delivery disabled until live permission rechecks
are tested.

### Deployment, backup, or database configuration exposes secrets or data

**Current control.** Reminder database transport defaults to verified TLS,
and deployment docs describe cold backups for project-owned volumes.

**Residual risk and owner.** The etke image override, existing `/data`
continuity, live TLS/CA settings, external log redaction, network boundaries,
secret delivery, and restore path have not been rehearsed on the operator host.
The operator owns those checks; repository CI is not deployment evidence.

## Deferred security gates

The following remain open in the implementation plan or require deployment
evidence before the stated behavior is available:

- M6 issue #7: appservice proof issuance after actor, membership, power, and
  exact-binding checks; real-Radicale room access and cross-room isolation.
- M8: rate limits and abuse controls, free/busy privacy, upgrade/migration,
  tested-client compatibility, and large-calendar/recurrence performance.
- Production: etke image/data rehearsal, proxy query-log redaction, external
  PostgreSQL TLS/CA validation, and restore rehearsal.
- Reminder delivery: authorized configuration endpoints, a scheduler,
  delivery-time permission checks, and delivery logging are not wired.

An independent source review checked this model's claims against the recorded
main snapshot. That review is not a penetration test or evidence that the
remaining security gates have passed. No live deployment or beta support is
implied by this document. Track milestone completion in [docs/PLAN.md](./PLAN.md) and
deployment blockers in [docs/STATUS.md](./STATUS.md).
