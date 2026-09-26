# ADR019: Store Matrix reminder sidecars in an app-owned PostgreSQL database

- Status: Accepted
- Date: 2026-09-26

## Context

ADR007 keeps Matrix-specific recipient intent and reminder delivery state out of
the canonical iCalendar resource. The initial selected reminder target is the
whole room through `m.mentions.room: true`. Event attendee email fields are
deferred until member-verified addresses and explicit consent are available;
they are not part of this reminder store decision.

The reminder sidecar and delivery ledger need durable storage. The deployment
may already operate PostgreSQL for Synapse, but Synapse owns its database
schema and credentials. Sharing a PostgreSQL cluster can reduce operational
overhead without making Synapse's database an application data boundary.

## Decision

1. Store Matrix reminder configuration and delivery state in a PostgreSQL
   database owned by this application, separate from CalDAV event data. Keep
   Radicale/CalDAV canonical for calendars, VEVENTs, and VALARMs. The database
   stores only the Matrix sidecar and the state needed to schedule and record
   delivery; it does not mirror or replace calendar resources.
2. Use a distinct calendar database and a least-privilege database role. An
   operator may place that database on an existing PostgreSQL cluster, including
   the cluster used by Synapse, but must not use Synapse's database, schema,
   role, or credentials. The application must not connect using the Synapse
   owner or initialization role.
3. Supply the connection URL to the server only through the Kubernetes Secret
   reference for `MATRIX_CALENDAR_REMINDER_DATABASE_URL`. Charts do not create
   the Secret, embed credentials in values, or provision PostgreSQL.
   Reminders are disabled by default. Enabling them requires an external Secret
   reference; an absent Secret or key prevents the pod from starting rather
   than permitting reminder delivery without durable state. Application code
   must also fail closed when the database URL is missing, empty, or the
   database is unavailable.
4. Keep reminder persistence independent of browser storage and iCalendar
   serialization. Sidecar identity follows ADR007's stable calendar, event,
   recurrence, and alarm identity. Lifecycle reconciliation must account for
   event, recurrence, alarm, and calendar deletion or identity changes.
5. Use database transactions and durable claims/delivery records as the
   coordination boundary for a future scheduler worker. This boundary may
   support multiple workers, but it does not make the whole server safe to run
   with multiple replicas. Keep `replicaCount: 1` by default; direct application
   multi-replica operation remains gated on bot-state and authentication
   architecture review.
6. Do not promise exactly-once Matrix delivery. Matrix message submission and
   database commit cannot be one atomic transaction. Delivery should be
   idempotent and recoverable, while documenting that a crash around the send
   boundary can produce a duplicate or require reconciliation.
7. The chart only projects a URL from an externally managed Secret when the
   reminder deployment option is enabled. It does not implement reminder
   scheduling or authorize `@room`; delivery still requires ADR007's
   delivery-time room visibility and permission checks.
8. Keep the server chart's existing `/app/storage` PVC behavior unchanged. That
   volume is for current bot filesystem state and is separate from PostgreSQL
   reminder persistence. PostgreSQL backup, restore, and retention must be
   handled as database operations.

## Consequences

- An operator must provision the application database and restricted role,
  create a Secret containing the connection URL, and configure the chart's
  external Secret name/key before enabling reminders.
- The existing `pg-credentials` Secret is used only by the optional Synapse
  rate-limit initialization container. The calendar application must not read
  or reuse it.
- A database transaction/claim model gives future scheduler workers a durable
  coordination seam, but does not settle the process-wide Matrix bot state or
  multi-replica authentication constraints.
- Whole-room `@room` reminder intent is the first product target. Event email
  attendees, address registration, and consent flows remain deferred.
- Live room-calendar integration remains subject to ADR014's trusted-domain
  boundary and the external M2 OpenID plugin/contract gates (#48 and #45).
  This decision does not close those gates or the separate M5 pinned Radicale
  interoperability gate.
- This ADR establishes the persistence and deployment boundary; database
  schema, migrations, scheduler behavior, permissions, and delivery tests
  remain implementation work.
