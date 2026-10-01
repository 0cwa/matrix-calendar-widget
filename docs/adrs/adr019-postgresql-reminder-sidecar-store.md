# ADR019: Store Matrix reminder state in app-owned PostgreSQL

- Status: Accepted
- Date: 2026-09-26

## Context

ADR007 keeps Matrix reminder targets outside iCalendar. The initial target is
the whole room through `m.mentions.room: true`; event attendee email fields and
verified-address/consent flows are deferred. CalDAV remains canonical for
calendar resources and alarms. Reminder configuration and delivery claims need
durable storage without placing application data in Synapse's database.

The service defaults to one replica. PostgreSQL transactions can coordinate
claims among workers, but that does not make other bot state or Matrix delivery
safe to scale horizontally.

## Decision

1. Store Matrix reminder configuration and delivery state in an application-
   owned PostgreSQL database, separate from CalDAV data and Synapse. Use a
   dedicated database and least-privilege application role. An operator may
   reuse a PostgreSQL cluster, but the application must never read or write
   Synapse tables or use Synapse's database, schema, role, owner, or credentials.
2. Store sidecar data in the `matrix_calendar` schema. A configuration identity
   includes room ID, bound calendar ID, event UID, recurrence identity, and
   stable VALARM UID. A delivery identity adds the trigger ordinal. Do not copy
   event titles, bodies, or other calendar content into PostgreSQL; CalDAV
   remains canonical.
3. Make persistence optional through
   `MATRIX_CALENDAR_REMINDER_DATABASE_URL`. If absent, the reminder store is
   disabled. If configured, the server applies versioned migrations at startup
   and fails startup when the database or migration is unavailable. Supply the
   URL through the operator's secret mechanism; never expose or log it.
4. Use unique delivery identities and transactional lease claims with claim
   tokens. Concurrent workers cannot hold the same active claim. Persisted
   claim and sent state provide at-most-once database claim/completion
   semantics; they do not promise exactly-once Matrix message delivery. A
   Matrix send accepted before the worker records sent state can be repeated
   after a crash.
5. Keep one server replica as the deployment default. Database claims are a
   necessary coordination primitive, not a general multi-replica safety claim.
   Backup and retention of the application database remain operator
   responsibilities.

## Consequences

- Operators who enable the store must provision an application-owned database
  and restricted role, provide its URL as a secret, and manage database backup
  and retention. The current code does not create databases or roles.
- The store and isolated PostgreSQL integration contract implement durable
  persistence primitives. They do not enable a reminder API, scheduler, or
  Matrix delivery. Room authorization and delivery-time permission checks
  remain separate work.
- The PostgreSQL runtime contract must pass in hosted CI before the store slice
  is considered complete. No production PostgreSQL endpoint has been tested.
