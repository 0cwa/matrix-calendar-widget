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

## Canonical identity resolution

The pure resolver validates one already-fetched CalDAV resource before an
identity is eligible for later sidecar use. It performs no I/O and enables no
settings API, scheduler, or Matrix delivery. An event UID, selected component,
and stable DISPLAY VALARM UID must each resolve unambiguously; legacy UID-less
alarms cannot be selected. Malformed source dates/times, duplicate recurrence
parameters, ambiguous identities, and unsupported RANGE forms fail closed
before parser normalization can alias them to a valid identity.

Use `null` for a master component. Detached component keys are JSON-serialized
tuples that preserve the original value kind and local value:

| Source kind          | Tuple                                                  |
| -------------------- | ------------------------------------------------------ |
| DATE                 | `["date", "YYYY-MM-DD"]`                               |
| Floating DATE-TIME   | `["date-time", "floating", "", "YYYY-MM-DDTHH:mm:ss"]` |
| UTC DATE-TIME        | `["date-time", "utc", "", "YYYY-MM-DDTHH:mm:ss"]`      |
| Named TZID DATE-TIME | `["date-time", "tzid", "TZID", "YYYY-MM-DDTHH:mm:ss"]` |

These canonical component keys are distinct from view-only occurrence IDs and
must not be copied blindly from a projected UI event. The resolver preserves
an unknown TZID structurally; scheduling must separately establish supported
timezone and alarm-trigger semantics. This foundation does not change the
store schema or migrate existing sidecar identities.

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
