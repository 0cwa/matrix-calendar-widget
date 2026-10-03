# Upgrade and migration runbook

This document defines a release and recovery procedure for a future, reviewed
Matrix Calendar deployment. It does not establish that the application is
production-ready, validate an etke-managed host, or authorize a deployment or
artifact publication. The repository remains pre-alpha; the current
[release policy](./release-versioning.md) explicitly permits breaking changes
and does not authorize live deployment or publication.

The only described deployment example is an operator-run Compose sidecar with
its own Radicale store. That sidecar is not an etke-managed Radicale upgrade,
does not use etke's existing `/data`, and does not migrate existing etke
calendar data. An etke image override, runtime configuration, persistent-data
continuity, PostgreSQL wiring, and rollback path still require operator
validation on the actual host.

## Data stores and migration behavior

Treat each store as a separate recovery boundary. Radicale/CalDAV remains the
canonical source for collections and calendar objects; an application or
widget rollback must not restore it implicitly.

**Radicale `/data`.** Radicale/CalDAV is canonical for collections and
iCalendar objects. The project-owned Compose example uses its own
`radicale-data` named volume. This repository defines no application-controlled
migration for Radicale's on-disk store and does not guarantee that an older
Radicale image can read a store touched by a newer image. Qualify each image
change against the exact data volume in an isolated rehearsal. etke's `/data`
is outside the project-owned backup procedure.

**Server `/app/storage`.** The Compose example persists the configured Matrix
SDK file store here; crypto state may also be present when enabled. Preserve
and cold back up the full volume. The repository defines no general downgrade
path for this state, so validate a candidate against an isolated restore.

**Optional application PostgreSQL.** If
`MATRIX_CALENDAR_REMINDER_DATABASE_URL` is absent, the reminder store is
disabled and no reminder-store schema migration runs. If configured, the
server applies numbered migrations at startup to the separate
`matrix_calendar` schema ([store implementation](../matrix-calendar-server/src/reminder/PostgresRoomReminderStore.ts),
[startup wiring](../matrix-calendar-server/src/app.module.ts)). At base
commit `cbd1a0a`, the source contains migration version 1. It creates
`schema_migrations`, `room_reminder_configurations`, `reminder_deliveries`,
and their indexes. It stores identifiers and delivery state, not event titles
or bodies. Record the exact before/after schema versions for every release
that changes them.

**Legacy Matrix control-room migration.**
`ENABLE_CONTROL_ROOM_MIGRATION` defaults to `false`
([configuration](../matrix-calendar-server/src/configuration.ts)). When
enabled, startup can update qualifying bot direct rooms: avatar, room name,
widget state, widget layout, and a room migration marker
([migration service](../matrix-calendar-server/src/service/ControlRoomMigrationService.ts)).
This writes Matrix room state and is independent of the PostgreSQL migration.
Keep it disabled during an ordinary upgrade. Enable it only for a separately
intended and rehearsed change; its sequential room-state writes can be partial
when an individual update fails, and the startup migration does not restore
prior state.

The PostgreSQL migration runner serializes migrations with a transaction-level
advisory lock and executes pending migration SQL and its version records
transactionally. Startup fails when the database or migration cannot be used. It
also rejects a database whose recorded migration version is newer than the
server supports. Do not hand-edit `schema_migrations`, run copied DDL, or treat
startup migration failure as permission to downgrade the database.

Provision a dedicated application-owned database and role before enabling the
store. The startup role needs permission to create and update this application's
schema and tables, but must not be a PostgreSQL superuser or have permission to
create databases or roles. The hosted restricted-role contract does not prove
production credentials, TLS settings, or database ownership on an operator
host; see [ADR019](./adrs/adr019-postgresql-reminder-sidecar-store.md) and
[ADR021](./adrs/adr021-postgresql-verified-tls.md).

The source has no automatic CalDAV data migration. The existing M6 room-owned
calendar path remains gated separately; passing a database migration does not
enable room-calendar access or prove that an etke-host image can preserve its
existing store.

## Before an upgrade

1. **Select one complete, reviewed release set.** Follow
   [release and versioning policy](./release-versioning.md). Record the source
   commit and immutable tag, exact server, widget, and project-owned Radicale
   image digests, chart package versions and exact child-chart dependencies if
   used, deployment-manifest/configuration revision, and SBOMs. Record the
   tested Matrix client, Radicale, PostgreSQL, and runtime compatibility set.
   Mutable tags such as `local`, `ci`, or `latest` are not deployment pins.
   For every application migration, record its starting and target schema
   version and the release's compatibility or recovery path.
2. **Confirm the deployment owner and storage boundary.** Identify every
   process that can write the selected CalDAV and server volumes, the
   application-owned database, and any Matrix room state. Confirm that the
   exact deployment file and project name address the intended resources. The
   project-owned `radicale-data` volume is not etke's `/data`; do not point the
   sidecar backup procedure at the etke store.
3. **Rehearse first in isolation.** Follow
   [backup and recovery](./backup-recovery.md) to create a cold backup and
   restore into a new isolated Compose project. Back up external PostgreSQL
   separately using its supported operator procedure, including the schema,
   data, and required roles/grants. Capture both recovery points in the same
   maintenance window while the application writer is stopped. CalDAV files
   and PostgreSQL do not have a cross-store atomic snapshot. Keep the restored
   environment on a staging homeserver, isolated database, and non-production
   network with test credentials.
4. **Check release-specific changes.** Review configuration changes,
   Radicale and PostgreSQL compatibility, required permissions, image digests,
   chart values, and any migration behavior. If the release record does not
   explicitly prove mixed-version operation, plan to replace the single
   application server with the tested compatible set while writes are
   stopped; do not run old and new server replicas against a migrating schema.
5. **Prepare a maintenance and recovery record.** Name the operator, exact
   starting artifact set, backup identifiers and checksums, PostgreSQL
   recovery point, target artifact set, and a tested recovery choice. Keep
   secret-bearing environment files out of transcripts and version control.

The backup procedure covers only the project-owned `radicale-data` and
`server-data` volumes. It does not configure backup retention, encryption,
off-host replication, or a production RPO/RTO. The application database is
external and needs its own backup. A volume archive and database dump from the
same outage are coordinated but not a single atomic snapshot; the isolated
restore must check that the paired data is coherent.

## Apply and validate an upgrade

1. **Stop writes and capture the cold backup.** Use the exact Compose file,
   project name, and environment for the deployment. Follow the stop and
   archive sequence in [backup and recovery](./backup-recovery.md), including
   stopping the widget, server, and Radicale writers and confirming no other
   process writes to the volumes. If PostgreSQL is configured, stop the server
   while its separate backup is made. Do not archive live volumes and call
   them consistent.
2. **Apply only the pinned compatible set.** Use the release's reviewed
   deployment values and documented rollout order. The Compose `:local`
   example is not a release pin. Keep the deployment at one server replica.
   With the reminder database configured, the new server applies its supported
   schema migrations during startup; no separate manual schema command is
   required. With the database setting absent, the reminder-store migration
   path remains disabled. Do not assume that image tags alone prove server,
   widget, and Radicale compatibility.
3. **Observe migration startup.** Require the server to start with the target
   schema version. A connection, configured TLS verification, DDL, or
   future-schema rejection is a
   stop condition. Retain the database and logs for diagnosis, with credentials
   and tokens redacted. Do not clear migration records or retry using an older
   image against an unknown schema.
4. **Run synthetic checks before reopening access.** Use a dedicated staging
   Matrix account and a non-sensitive canary calendar. Confirm widget loading,
   OpenID authentication, personal-calendar read, and canary create/read/update/
   delete behavior. Check the migration record and that expected reminder
   identifiers remain available if the optional store is enabled. Do not use
   real user event contents in the report, and do not send real Matrix
   notifications. Room-target checks remain unavailable until their separate
   M6 authorization, appservice, cross-room-isolation, and deployment gates
   pass.
5. **Record the result.** Record pass/fail, elapsed maintenance and restore
   times, release commit and image digests, chart/configuration revisions,
   database migration version, and any data or permission discrepancy. Do not
   record secrets, event titles, attendee details, access tokens, or complete
   iCalendar resources.

## Failure and rollback

Prefer a forward fix when the server rejects a migration or a synthetic check
fails. Preserve the database and canonical CalDAV store while diagnosing the
failure. A previous server image may run against a migrated database only when
the exact release record provides evidence that it supports that schema. The
pre-alpha policy has no general backward-compatibility promise and no automatic
PostgreSQL downgrade.

If a prior server is not documented as compatible with the new schema, do not
start it against that database. First restore the database backup into an
isolated database and validate it with the paired application release and the
isolated CalDAV copy. Decide separately whether a forward fix or a coordinated
recovery is appropriate. Do not silently restore or replace the canonical
Radicale data as part of rolling back the server, widget, or chart. Any
production data restore requires an operator-approved recovery action and a
verified procedure for each store; it is outside an application-image rollback.

A PostgreSQL migration error or future-schema refusal must fail closed: keep
traffic stopped, retain the original database, redact sensitive logs, and
resolve the failure with the release owner. Do not delete tables, lower the
recorded schema version, or use an image that merely appears to start. If a
recovery copy is needed, restore to a new isolated database and test there.

## Deployment-specific stop conditions

Do not treat this runbook as authorization or evidence for an etke-managed
rollout. Before considering a host rehearsal, its operator must confirm a
supported custom-image extension path and rehearse the exact image, Radicale
configuration, network, service lifecycle, and preservation of the existing
`/data` store. The current etke deployment behavior and its PostgreSQL wiring
remain unverified. If the host cannot preserve the existing canonical store,
stop and plan a separate CalDAV migration with the operator; the Compose
sidecar example creates an independent Radicale service and does not perform
that migration.

This runbook records a future procedure only. It does not execute an upgrade,
create a release, publish images or charts, or imply that a live deployment or
recovery rehearsal has passed.
