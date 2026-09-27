# Threat model and security review

_Review scope: local integration branch `codex/m6-reminder-integrated`, source
snapshot `a2d0ab02087d845449b9e025327aabb75a377ca7`, 2026-09-27._

This is a source and test review for M8 issue #9. It records the current trust
boundaries, implemented controls, and remaining security gates. It is not a
penetration test, a deployment audit, or approval to run a controlled pilot.
No live Matrix homeserver, Radicale server, PostgreSQL database, Kubernetes
cluster, or browser session was exercised for this review. Tests linked below
are evidence of the assertions in their source; their presence does not prove
that an external service was tested. The recorded integration status is in
[Project status](STATUS.md).

## Product data and trust boundaries

The sensitive assets in this product are:

- Calendar collections and event content in CalDAV, including titles,
  descriptions, dates, locations, URLs, recurrence, and VALARMs. Existing
  iCalendar data can contain properties and components the widget does not
  understand. Attendee addresses, when supplied by another CalDAV client, are
  also sensitive even though the current gateway event DTO does not expose
  attendees.
- Matrix user identity assertions, the server-side bot access token, delegated
  CalDAV credentials, and the PostgreSQL connection URL.
- Static room-to-calendar bindings and Matrix membership/power state, which
  control which room can reach which app-owned calendar.
- Reminder sidecar identities and delivery state: room, calendar, event UID,
  recurrence identity, alarm UID, and delivery claim state. This metadata can
  reveal activity even though it does not copy event titles or bodies.
- The server's ability to send a Matrix room mention and its bot session state.

The current architecture has these boundaries:

1. The widget obtains a short-lived OpenID credential from the Matrix Widget
   API and sends it to the gateway in an `MX-Identity` authorization header.
   The gateway must treat every request field, including room, calendar, event,
   recurrence, and alarm identifiers, as untrusted.
2. The gateway asks the configured homeserver to validate the user identity,
   then checks current room membership and action-specific power before
   allowing room-scoped operations.
3. An operator-managed binding selects one app-owned room calendar. The
   gateway's service principal is broader than one collection under the current
   Radicale `owner_only` policy; the binding narrows ordinary application
   requests but is not a Radicale isolation boundary.
4. Radicale remains canonical for collections, VEVENTs, recurrence, and
   VALARMs. Matrix reminder configuration and delivery claims are separate in
   an app-owned PostgreSQL database; neither the Synapse database nor the
   `/app/storage` PVC is the reminder database.
5. A future reminder worker would send through the authenticated Matrix bot
   client. The current room-mention sender is an isolated helper, not a
   scheduler or end-to-end reminder path.
6. Deployment operators control the bot credentials, optional reminder
   database connection, filesystem storage, image, configuration, and backups.
   The optional Helm chart does not provision PostgreSQL or its credentials.

## Deployment context

The expected first operator path is this project's server Docker image managed
by Ansible under etke's Matrix Docker Ansible Deployment (MDAD); this
repository has a [server Dockerfile](../matrix-calendar-server/Dockerfile) and
a [development Compose file](../dev/compose.yaml) for Synapse and Radicale,
but no MDAD add-on role or integration. MDAD describes Docker-managed services
and configurable add-on network, homeserver URL, and reverse-proxy settings;
these settings do not prove that this app container is attached or reachable.
Reusing a PostgreSQL host requires a separately provisioned app database and
least-privilege role plus a working route from the app container; MDAD's docs
do not establish that Synapse's PostgreSQL container is reachable from an
add-on. The [Helm charts](../charts/README.md) are optional pre-alpha
scaffolding, not the expected first operator path. These claims are scoped to
MDAD commit
[`c8087f4`](https://github.com/spantaleev/matrix-docker-ansible-deploy/commit/c8087f4f2065052ac81f680cb72f7a9b3ea6e5f6):
[README](https://github.com/spantaleev/matrix-docker-ansible-deploy/blob/c8087f4f2065052ac81f680cb72f7a9b3ea6e5f6/README.md),
[add-on network and homeserver defaults](https://github.com/spantaleev/matrix-docker-ansible-deploy/blob/c8087f4f2065052ac81f680cb72f7a9b3ea6e5f6/roles/custom/matrix-base/defaults/main.yml#L62-L73),
[proxy defaults](https://github.com/spantaleev/matrix-docker-ansible-deploy/blob/c8087f4f2065052ac81f680cb72f7a9b3ea6e5f6/roles/custom/matrix-base/defaults/main.yml#L261-L296),
[external PostgreSQL guidance](https://github.com/spantaleev/matrix-docker-ansible-deploy/blob/c8087f4f2065052ac81f680cb72f7a9b3ea6e5f6/docs/configuring-playbook.md),
and [service-specific database setup](https://github.com/spantaleev/matrix-docker-ansible-deploy/blob/c8087f4f2065052ac81f680cb72f7a9b3ea6e5f6/docs/configuring-playbook-bridge-mautrix-signal.md).

## Threats, controls, and residual risk

### Forged identity or stolen/replayed proof

**Abuse path.** A caller supplies an invented user ID, a token belonging to a
different user, or an expired/stolen OpenID proof to access another person's
calendar or act as a different room member.

**Implemented controls and evidence.** The widget requests a Matrix OpenID
credential through `requestOpenIDConnectToken()` and places that credential in
the gateway header in [`AppContainer.tsx`](../matrix-calendar-widget/src/AppContainer.tsx).
The gateway resolves the identity through the configured homeserver in
[`MatrixAuthMiddleware.ts`](../matrix-calendar-server/src/middleware/MatrixAuthMiddleware.ts);
room authorization uses the resulting server context, not a client-supplied
actor field. The middleware unit tests cover a valid OpenID exchange and a
homeserver rejection in
[`MatrixAuthMiddleware.test.ts`](../matrix-calendar-server/test/middleware/MatrixAuthMiddleware.test.ts).
The reminder controller also rejects caller-supplied actor or calendar fields
in [`RoomReminderConfigurationController.test.ts`](../matrix-calendar-server/src/controller/RoomReminderConfigurationController.test.ts).
These controls follow [ADR006](adrs/adr006-matrix-authenticated-caldav-gateway.md)
and the personal-calendar part of
[ADR009](adrs/adr009-radicale-openid-delegation.md).

**Residual risk and gate.** The external Radicale plugin currently lacks the
OpenID mode required by ADR009 (#48), and the final real gateway-to-Radicale
OpenID/non-member contract (#45) has not passed. The current middleware trusts
the configured homeserver's `sub` response without checking that it is a
string in Matrix user-ID form; its existing test fixture uses a numeric `sub`.
The real contract must reject malformed identity responses and prove that the
delegated credential represents exactly the validated actor. Short-lived proof
can still be stolen from a compromised client or gateway process. The
middleware logs authentication exception text, and its failure path includes
homeserver response text; this review did not establish what a deployed
homeserver returns or verify logger redaction. Gateway maintainers own the
identity contract and log-redaction evidence; #48/#45 remain release gates.

### Cross-room or cross-collection access

**Abuse path.** A room member changes a request room/calendar identifier,
supplies a DAV URL, or exploits an ambiguous binding to read or edit another
room's collection.

**Implemented controls and evidence.**
[`MatrixCalendarAuthorization.ts`](../matrix-calendar-server/src/service/MatrixCalendarAuthorization.ts)
requires current membership for every action, checks event-write or
calendar-management power for mutations, and denies on membership or
power-state lookup failure. The static resolver in
[`RoomCalendarBindingResolver.ts`](../matrix-calendar-server/src/service/RoomCalendarBindingResolver.ts)
rejects malformed, duplicate, missing, and mismatched room/calendar targets.
The gateway resolves the configured binding and applies authorization before
CalDAV access. Unit tests cover membership/power failures in
[`MatrixCalendarAuthorization.test.ts`](../matrix-calendar-server/src/service/MatrixCalendarAuthorization.test.ts),
duplicate and mismatched bindings in
[`RoomCalendarBindingResolver.test.ts`](../matrix-calendar-server/src/service/RoomCalendarBindingResolver.test.ts),
and denial before CalDAV in
[`CalendarGatewayController.test.ts`](../matrix-calendar-server/src/controller/CalendarGatewayController.test.ts).
This matches [ADR014](adrs/adr014-split-widget-and-bot-calendar-principals.md)
and [ADR015](adrs/adr015-server-managed-room-calendar-bindings.md).
Production room-principal CalDAV access is explicitly disabled by
[`RoomCalendarCalDavAccess.ts`](../matrix-calendar-server/src/service/RoomCalendarCalDavAccess.ts)
until its dependencies are ready.

**Residual risk and gate.** Under `owner_only`, the app-owned Radicale principal
can access its whole home. A compromised gateway or service principal can
therefore cross the application mapping and access other collections in that
home. The mapping is not per-room backend isolation. Before serving mutually
untrusted rooms, operators must establish and verify separate service-principal
homes or equivalent Radicale authorization; absent that, keep the home within
one trusted organizational boundary. The #48/#45 CalDAV contract and this
ADR014 trust-domain gate remain open. Operators own isolation; gateway owners
own request-scoping tests.

### Hostile or unexpectedly complex iCalendar input

**Abuse path.** A CalDAV writer stores malformed or unusually large iCalendar
content, repeated event/alarm identities, or complex recurrence/timezone data
that is read or edited by the widget and gateway.

**Implemented controls and evidence.** Radicale responses are parsed before
conversion by
[`CalDavEventClient.ts`](../matrix-calendar-server/src/caldav/CalDavEventClient.ts)
and [`ICalendarEventCodec.ts`](../matrix-calendar-server/src/caldav/ICalendarEventCodec.ts).
The codec preserves unknown properties when editing and validates supported
VEVENT/recurrence operations. Its timezone expansion has a bounded-work check
covered by [`ICalendarEventCodec.test.ts`](../matrix-calendar-server/src/caldav/ICalendarEventCodec.test.ts).
Reminder alarm resolution rejects duplicate or malformed event, recurrence,
and VALARM identities and returns identity-only errors in
[`CanonicalReminderIdentityResolver.ts`](../matrix-calendar-server/src/reminder/CanonicalReminderIdentityResolver.ts)
and [`CanonicalReminderIdentityResolver.test.ts`](../matrix-calendar-server/src/reminder/CanonicalReminderIdentityResolver.test.ts).

**Residual risk and gate.** CalDAV event responses are read as text before
parsing; this review found no response-size cap or overall iCalendar resource
size limit in the inspected path. Bounded timezone expansion does not bound
network body size or every parser cost. The review did not perform parser
fuzzing, resource-exhaustion testing, or a hostile-input runtime test. Server
maintainers should define request/resource limits and add malformed and
high-cost fixtures before a multi-tenant pilot. Until then, only trust the
configured Radicale endpoint and its authorized writers; do not accept
untrusted calendar servers as sources.

### Reminder identity tampering and stale sidecar state

**Abuse path.** A caller stores a reminder for an event or alarm that is not in
the bound calendar, changes identifiers to target another room, or leaves an
active reminder after an external CalDAV edit/deletion.

**Implemented controls and evidence.** The authenticated reminder API derives
the actor from middleware and the room from the route, checks current room
membership, event-write power, and the static binding, then stores only
room/calendar/event/recurrence/alarm identifiers. It does not accept a
caller-selected calendar. These boundaries are covered by
[`RoomReminderConfigurationController.test.ts`](../matrix-calendar-server/src/controller/RoomReminderConfigurationController.test.ts)
and [`RoomReminderConfigurationService.test.ts`](../matrix-calendar-server/src/service/RoomReminderConfigurationService.test.ts).
The pure canonical resolver matches exact event UID, recurrence identity, and
unique DISPLAY alarm UID; it fails closed on missing or ambiguous data.
[`ADR020`](adrs/adr020-display-alarm-lifecycle.md) defines the stable alarm
identity used for future sidecar linkage.

**Residual risk and gate.** The API stores inert intent and does not verify
that the event, recurrence, or alarm exists in Radicale. The resolver has no
CalDAV caller. There is no M6 scheduler or production caller of the sender;
widget controls/wiring, canonical resource lookup, lifecycle cleanup,
delivery-time actor/policy checks, and Matrix sends remain incomplete. External
CalDAV clients can remove or change an alarm UID. A future scheduler must read
the current canonical resource and stop on absent, changed, or ambiguous
identity before every delivery. Gateway maintainers own the missing read and
scheduler path; #48/#45 and the ADR014 isolation gate remain prerequisites.

### Unauthorized or excessive `@room` reminders

**Abuse path.** An unauthorized process sends a room ping, the bot loses
permission between configuration and delivery, or an authorized user creates
many reminder intents that later produce disruptive notifications.

**Implemented controls and evidence.** The isolated
[`RoomReminderMatrixDelivery.ts`](../matrix-calendar-server/src/reminder/RoomReminderMatrixDelivery.ts)
checks that the bot remains joined and meets the room notification power
threshold immediately before sending a standard `m.mentions.room: true`
message. It fails closed if the room/power lookup is missing or malformed.
Its unit test covers a permitted send and deny paths in
[`RoomReminderMatrixDelivery.test.ts`](../matrix-calendar-server/src/reminder/RoomReminderMatrixDelivery.test.ts).
The reminder configuration API separately requires a joined room actor with
event-write power. These are unit-level checks only; [ADR007](adrs/adr007-matrix-reminder-sidecar-metadata.md)
requires delivery-time recipient visibility and room-mention permission.

**Residual risk and gate.** The sender helper has no production caller and no
scheduler exists, so no end-to-end permission or send path has been exercised.
The helper checks bot membership/power, not the original actor's current
authorization; the eventual caller must reauthorize the configured intent and
current event visibility at delivery time. There is no rate limit or abuse
control on reminder configuration or notifications. The M8 rate-limits and
abuse-controls item remains open and is a separate implementation gate before
enabling a scheduler. Gateway maintainers own caller and throttling controls;
room administrators own the bot's power-level policy.

### PostgreSQL exposure, retries, and recovery

**Abuse path.** An attacker reads or alters reminder configuration/claim data,
uses the application database credential to access Synapse or unrelated data,
or triggers duplicate notifications after a crash or restore.

**Implemented controls and evidence.** [ADR019](adrs/adr019-postgresql-reminder-sidecar-store.md)
places sidecar data in a separate app-owned database and `matrix_calendar`
schema, with a least-privilege role. The store records identifiers and claim
state rather than event titles or bodies. The database URL is optional;
without it, reminder operations fail as disabled. When configured, migration
failure prevents successful startup. The PostgreSQL adapter in
[`PostgresRoomReminderStore.ts`](../matrix-calendar-server/src/reminder/PostgresRoomReminderStore.ts)
uses unique delivery identities and atomic lease claims. The disabled-store
and delivery-key unit tests are in
[`RoomReminderStore.test.ts`](../matrix-calendar-server/src/reminder/RoomReminderStore.test.ts).

**Residual risk and gate.** The PostgreSQL integration contract in
[`PostgresRoomReminderStore.integration.test.ts`](../matrix-calendar-server/src/reminder/PostgresRoomReminderStore.integration.test.ts)
is skipped unless `MATRIX_CALENDAR_REMINDER_DATABASE_URL` is provided; the
recorded validation left that URL unset. Concurrent claims, migrations,
database outage, and restore/replay behavior have not been verified against a
live database. Matrix send and database commit cannot be atomic, so delivery is
at-least-once and a crash after Matrix accepts a message can cause a duplicate.
Database restore can roll delivery state back and replay notifications.
Operators own database isolation, least-privilege credentials, backup,
retention, and restore exercises; server maintainers own the live integration
gate. Keep the one-replica default; claims alone do not prove the rest of the
server is safe to scale horizontally. See [Backup and recovery](backup-and-recovery.md).

### Container deployment credentials, logs, and filesystem state

**Abuse path.** A host, container, or deployment-log reader obtains a bot
password, Matrix access token, CalDAV credential, or database URL from
rendered configuration, process arguments, environment, logs, or an
incorrectly assumed persistent volume.

**Implemented controls and evidence.** The source-reviewed local commit
`a2d0ab0` removes shell tracing from the optional Helm bot setup paths and
removes token-response/access-token output from the login helper. The generated
token still uses the chart's `/work-dir/.env` handoff to the bot container.
The optional Helm chart defaults to one server replica, reminders disabled,
and `/app/storage` ephemeral. When reminders are enabled through that chart,
the deployment requires the database URL from a named external Kubernetes
Secret and rejects that URL in `settings.additionalEnv`; the chart does not
create the database or Secret. Its server container drops Linux capabilities,
is non-root, and uses a read-only root filesystem by default. The optional PVC
is separate from PostgreSQL. These chart-specific controls are in
[`values.yaml`](../charts/matrix-calendar-server/values.yaml) and
[`deployment.yaml`](../charts/matrix-calendar-server/templates/deployment.yaml),
with chart operator responsibilities in [Backup and recovery](backup-and-recovery.md).
The `matrix-calendar-server` Docker image is defined by
[`Dockerfile`](../matrix-calendar-server/Dockerfile); no MDAD service wiring,
secret handoff, or persistent volume policy for this image has been validated.

**Residual risk and gate.** Both optional bot setup paths still pass the bot
password as a child-process argument:

- `createUserAccount` passes `BOT_PASSWORD` to `register_new_matrix_user -p`
  in [`create_bot_account.sh`](../charts/matrix-calendar-server/files/shell-tools/create_bot_account.sh).
- `getFreshDeviceToken` includes `BOT_PASSWORD` in the `curl -d` login request
  in [`get_meetings_bot_token.sh`](../charts/matrix-calendar-server/files/shell-tools/get_meetings_bot_token.sh).

When the chart init paths are enabled, these values can be visible to
sufficiently privileged process inspectors while the child process runs;
actual visibility depends on host, container, and `/proc` access policy. The
chart defaults both options to `false`, and the logging fix does not remove
the process-argument exposure. Chart maintainers own a safer credential
handoff or an explicit accepted boundary before either chart option is enabled;
operators own process and container access controls. No process-argument
visibility test was run. The general Helm `settings.additionalEnv` interface
also accepts arbitrary environment values; operators must use Secret
references for credentials. Its optional PVC stores bot filesystem/session
state only and is not a backup of PostgreSQL or Radicale. Kubernetes Secret
RBAC/encryption, pod-log access, and PVC persistence are chart deployment
properties not tested here. For the expected Docker/Ansible path, volume
persistence and secret injection need explicit integration work and were not
verified in MDAD.

## Evidence limits and open gates

The source contains focused tests for the gateway authorization, binding,
identity resolver, reminder store, and sender helper listed above. The
repository status records a full `CI=true yarn ci` pass on integration snapshot
`3a8691a0b1f36c0bf03c9af6c1ea8626a4760586`; the sender helper was added after
that snapshot, and this review did not rerun tests. Presence of its unit test
is not a test result. The CalDAV runtime contracts are gated on
`CALDAV_CONTRACT=1` and were not run because the pinned service runtime was
unavailable. The PostgreSQL contract was skipped because its database URL was
unset. The chart logging fix was source/static checked, but Helm render/lint
was not run because Helm is unavailable; no init container or live
Kubernetes deployment was exercised. No live Matrix room-mention delivery was
performed. Matrix, CalDAV, PostgreSQL, and Kubernetes integration remain
unvalidated.

The following remain release gates, not conclusions of this review:

- #48 OpenID support in the pinned Radicale auth plugin and #45's real gateway
  delegation/non-member contract.
- ADR014 service-principal isolation for Radicale's whole-home `owner_only`
  access before serving mutually untrusted rooms.
- M5's pinned Radicale recurring-resource round-trip and PostgreSQL's live
  migration/claim integration.
- M6's widget configuration, canonical CalDAV resource lookup, scheduler,
  delivery-time actor/event checks, and Matrix notification caller.
- M8 rate limits and abuse controls, plus the remaining pilot/deployment,
  upgrade, compatibility, performance, and release-policy work in
  [`PLAN.md`](PLAN.md).

This review closes only the M8 threat-model/security-review documentation
item. It does not certify the deployment, establish backup recovery, close
issue #9, or establish readiness for a controlled pilot. All other M8
deployment and release gates remain open.
