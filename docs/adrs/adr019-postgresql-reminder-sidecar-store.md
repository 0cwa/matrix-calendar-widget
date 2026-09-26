# ADR019: Store Matrix reminder state in an app-owned PostgreSQL database

- Status: Accepted
- Date: 2026-09-26

## Context

ADR007 keeps Matrix-specific reminder targets outside iCalendar. The initial
reminder target is the whole room through `m.mentions.room: true`; event
attendee email fields and verified-address/consent flows are deferred. CalDAV
remains canonical for events and VALARMs. Reminder configuration and delivery
state need durable storage that can coordinate claims without putting
application data in Synapse's database or mirroring calendar resources.

The initial server deployment remains one replica. A shared application-owned
database and atomic claim protocol establish a path for future workers, but do
not make the whole bot/server safe to scale horizontally. Operators may already
run PostgreSQL for Synapse, but that does not make Synapse's database, schema,
role, or credentials an application data boundary.

## Decision

1. Store Matrix reminder configuration and delivery state in a PostgreSQL
database owned by Matrix Calendar Widget, separate from CalDAV event data and
Synapse. Use a distinct application database and least-privilege role. An
operator may reuse a PostgreSQL cluster, including a cluster used by Synapse,
but the application must never read or write Synapse tables or use its database,
schema, role, owner, or initialization credentials.
2. Keep reminder metadata in the `matrix_calendar` schema. Identity includes the
room, bound calendar, event UID, recurrence instance, and stable VALARM UID; it
does not copy event titles, bodies, or other calendar content. CalDAV remains
canonical for calendar resources and alarm timing.
3. Configure the optional connection with
`MATRIX_CALENDAR_REMINDER_DATABASE_URL`. Without it, reminder persistence is
disabled and store operations fail explicitly. A configured URL enables startup
migrations; connection or migration failure prevents startup rather than
leaving persistence partially initialized. The application must fail closed
when the database is unavailable.
4. Supply the URL through deployment secret configuration. The Helm chart
projects it only from an externally managed Kubernetes Secret when reminders
are enabled. The chart does not create the Secret or provision PostgreSQL, and
reminders default to disabled. A missing Secret or key prevents the pod from
starting. Do not put the URL in Helm values or `settings.additionalEnv`.
5. Use unique reminder-delivery identities and atomic PostgreSQL lease claims
with claim tokens. Only one worker can hold an unexpired claim for a delivery;
expired or explicitly released claims can be retried. Persist sent state before
considering the delivery complete. The implemented storage port and
PostgreSQL adapter provide this durable claim boundary; the scheduler and
reminder configuration API remain future work.
6. Treat Matrix delivery as at-least-once. Matrix may accept a message before
the worker records the sent state, so a crash in that gap can cause a duplicate
on retry. Exactly-once Matrix event delivery cannot be guaranteed by a database
transaction.
7. Keep Matrix tokens, OpenID assertions, CalDAV credentials, and complete
iCalendar bodies out of the store and logs. Lifecycle reconciliation must
account for event, recurrence, alarm, or calendar deletion and identity changes.
8. Pin the directly declared Postgres.js driver to the existing lock resolution,
`3.4.5`. Review upstream transaction-reservation issue
[#1189](https://github.com/porsager/postgres/issues/1189) and connection queue
issue [#1195](https://github.com/porsager/postgres/issues/1195) before upgrading
to `3.4.9`; revisit the pin after upstream fixes and a successful PostgreSQL
integration run.
9. Keep the server chart's existing `/app/storage` PVC behavior unchanged. It
stores current bot filesystem state and is separate from PostgreSQL reminder
persistence. Keep `replicaCount: 1` by default; database claims do not settle
bot-state and authentication requirements for multiple server replicas.
10. Reminder delivery still requires ADR007's current visibility and
`@room`-permission checks. This decision does not add reminder configuration
endpoints, scheduling, Matrix delivery wiring, or relax the #48/#45 Radicale
delegation and ADR014 trusted-domain gates.

## Consequences

- Operators must provision the application database and restricted role, then
  create an external Secret containing the connection URL before enabling the
  chart option. PostgreSQL backup, restore, and retention remain database
  operations; delivery rows require a retention policy that preserves the
  retry/replay window.
- A one-replica deployment can persist reminder metadata across restarts. The
  claim protocol supports contention among future workers, but does not
  authorize general multi-replica server operation.
- The store and claim adapter are implemented with local unit coverage and a
  PostgreSQL integration contract. Live PostgreSQL integration remains
  dependent on an available database. The scheduler, authenticated reminder
  configuration API, permission checks, and delivery remain unimplemented.
- Whole-room `@room` is the first reminder target. Email attendees,
  verified-address registration, and consent flows remain deferred.
- Live room-calendar integration remains subject to ADR014's trusted-domain
  boundary and the external M2 OpenID plugin/contract gates (#48 and #45), as
  well as the separate M5 pinned Radicale interoperability gate.
