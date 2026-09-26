# ADR019: Store Matrix reminder state in an app-owned PostgreSQL database

- Status: Accepted
- Date: 2026-09-26

## Context

ADR007 keeps Matrix-specific reminder targets outside iCalendar. The Matrix
homeserver supplies identity, membership, power-level authorization, and
notification delivery. CalDAV remains canonical for events and VALARMs. Reminder
configuration and delivery retry state need durable storage that can coordinate
multiple server workers without putting application data in Synapse's database.

The user selected one server replica for the initial deployment and requested a
design that can support additional workers later. A single local JSON file would
lose state without a persistent volume and cannot coordinate replicas safely.

## Decision

1. Store Matrix reminder configuration and delivery-claim state in a PostgreSQL
   database owned by Matrix Calendar Widget. Never read or write Synapse tables
   or schemas. Prefer a dedicated database on an operator-managed PostgreSQL
   cluster when available, with a role scoped to that application database and
   schema.
2. Keep reminder metadata in the `matrix_calendar` schema. It identifies the
   room, bound calendar, event UID, recurrence instance, and stable VALARM UID;
   it does not copy event titles, bodies, or other calendar content. CalDAV
   remains the source of event and alarm timing data.
3. Configure the optional connection using
   `MATRIX_CALENDAR_REMINDER_DATABASE_URL`. Without the setting, reminder
   persistence is disabled and store operations fail explicitly. Supplying a
   URL enables startup migrations; a connection or migration failure prevents
   the service from starting with partially initialized reminder persistence.
4. Use unique reminder-delivery identities and atomic PostgreSQL lease claims
   with claim tokens. Multiple workers may contend for one delivery, but only
   one can hold an unexpired claim. Expired or explicitly released claims can
   be retried. Persist the sent state before considering the same delivery
   complete.
5. Treat delivery as at-least-once. Matrix may accept a message before the
   worker records the sent state; a crash in that gap can cause a duplicate on
   retry. The database cannot provide exactly-once Matrix event delivery.
6. Keep Matrix tokens, OpenID assertions, CalDAV credentials, and complete
   iCalendar bodies out of the store. The database URL must be supplied through
   deployment secret configuration and must never be logged.
7. Directly declare and pin the Postgres.js driver to the existing repository
   lock resolution, `3.4.5`. Review upstream transaction-reservation issue
   [#1189](https://github.com/porsager/postgres/issues/1189) and connection
   queue issue [#1195](https://github.com/porsager/postgres/issues/1195) before
   upgrading to `3.4.9`; the reported behavior can undermine this adapter's
   transaction and multi-worker reliability assumptions. Revisit the pin after
   an upstream fix and a successful PostgreSQL integration run.

## Consequences

- A one-replica deployment can persist reminder metadata across restarts, and
  the same atomic claim protocol supports multiple workers against the shared
  application database.
- Database setup is optional until reminder persistence is configured. Room
  reminders must remain unavailable while no database URL is present.
- Delivery rows retain idempotency history after an event or reminder
  configuration is removed. A later retention policy must preserve the
  deployment's retry and replay window before pruning that history.
- This decision does not add a scheduler, API, widget controls, or Matrix
  delivery wiring. It does not lift the #48/#45 Radicale delegation or trusted
  room-principal isolation gates.
