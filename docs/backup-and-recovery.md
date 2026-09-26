# Backup and recovery

This runbook describes operator procedures for the Matrix Calendar server's
application-owned reminder data and optional bot filesystem storage. It does
not configure backups or guarantee a recovery point or recovery time. Choose
and test those policies for the deployment.

## What to protect

| Data                                       | Location and purpose                                                                                                                                                                                      | Default and owner                                                                                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reminder configuration and delivery claims | A separate application-owned PostgreSQL database, in the `matrix_calendar` schema. It contains room/calendar/event/recurrence/alarm identifiers and delivery state, not event titles or calendar objects. | The chart does not provision it. The operator provisions the database and least-privilege role.                                                                                                          |
| Bot filesystem state                       | `/app/storage`, including persisted bot session state.                                                                                                                                                    | `persistence.enabled` is `false` by default, so this path uses ephemeral storage unless the operator enables the chart PVC or supplies an existing claim.                                                |
| Connection and deployment configuration    | The Kubernetes Secret named by `reminders.databaseUrl.existingSecret` and key named by `existingSecretKey`, plus the chart values and release/image identity needed to recreate the deployment.           | The Secret is external to the chart and is required only when reminders are enabled. Protect it with the cluster's approved secret backup and access controls.                                           |
| Calendar collections and events            | Radicale/CalDAV.                                                                                                                                                                                          | Radicale remains canonical. Neither this PostgreSQL database nor `/app/storage` backs up calendar collections, VEVENTs, or VALARMs. Back up and restore Radicale independently using its own procedures. |

Reminders are disabled by default. When enabled, the chart injects
`MATRIX_CALENDAR_REMINDER_DATABASE_URL` from the external Secret; it does not
create a database or Secret. Do not put the URL in Helm values,
`settings.additionalEnv`, shell history, command output, or support logs. Do not
use Synapse's database, schema, role, or `pg-credentials` Secret. Rotating the
Secret requires a server pod restart because the connection is read at startup.

## Choose a backup policy

Select retention, backup frequency, off-site copies, encryption, access, and
restore objectives for each system. The chart sets none of these values and
does not provide backup jobs or retention guarantees. Retain database backups
long enough for the deployment's recovery and investigation needs; remove old
copies only under the operator's approved retention policy. Protect database
exports, volume snapshots, and Secret/configuration backups as sensitive data.

For PostgreSQL, use the database platform's supported backup/PITR process or a
consistent logical dump. For example, from a secured administration host with
a protected PostgreSQL service definition and credentials supplied through
the site's secret mechanism:

```sh
pg_dump --format=custom --dbname=service=matrix-calendar-backup \
  --file="$BACKUP_DIR/matrix-calendar-reminders.dump"
```

The service definition must point to the app-owned database, never Synapse.
Restrict access to the dump and encrypt it at rest and in transit. Record the
backup time, application image/chart version, and database backup method in the
operator's protected backup inventory; do not record the connection URL.

If `/app/storage` persistence is enabled, separately back up its PVC using the
storage provider's supported snapshot or file-copy method. The default chart
uses ephemeral storage, which is not a durable backup source. Preserve the PVC
claim/volume mapping and required access mode as deployment metadata. If
persistence is disabled, there is no PVC to back up; decide separately whether
loss of bot filesystem state is acceptable.

Back up the external Secret and non-secret chart/release configuration using
the cluster's approved encrypted configuration backup. Include the Secret
name/key references, reminder enablement, persistence settings, release
revision, and exact server image tag or digest. Never include Secret values in
plain-text runbooks, tickets, or command transcripts.

## Make a coordinated recovery point

PostgreSQL provides a consistent database snapshot, but a database backup and
a PVC snapshot taken at different times are not automatically one coordinated
application snapshot. To capture a coordinated recovery point:

1. Record the current chart release, server image tag or digest, database
   backup point, PVC identity (if enabled), and configuration/Secret version
   in the protected inventory.
2. Stop all Matrix Calendar server processes that can write reminder state or
   `/app/storage`. For the chart deployment, pause scheduling and scale the
   server workload to zero; also stop any separately operated workers.
3. Back up the PostgreSQL database and, if enabled, snapshot/copy the PVC while
   the writers remain stopped. Capture the external Secret/configuration
   version through the approved secret-management process.
4. Confirm each backup completed and is readable according to the storage
   provider's checks, then restart the original workload.

If the database provider's supported backup method is online and you choose
not to stop the app, document that the database and PVC may represent
different points in time. Do not describe independently captured backups as
application-consistent.

## Restore

Use a maintenance window and keep the application stopped until all selected
state is restored. A restore replaces current state; confirm the target
database, PVC, namespace, and release before applying it.

1. Select a mutually compatible backup set. Restore the app-owned PostgreSQL
   backup to the intended database, and restore the PVC snapshot to its
   intended claim if `/app/storage` persistence was enabled. Restore the
   matching Secret and chart/release configuration through approved
   secret-management and deployment procedures. Keep the server scaled to zero.
2. Point the external Secret reference at the restored app-owned database.
   Verify the configured key exists without printing its value. Confirm the
   database name and role are the Matrix Calendar ones, separate from Synapse.
3. Deploy the same Matrix Calendar server image version that wrote the backup,
   with the matching chart configuration and PVC mount. Pin the image tag or
   digest; the chart's placeholder `appVersion` is not evidence of a compatible
   production image.
4. Start one server replica and inspect readiness and startup logs for
   connection or migration failures. ADR019 runs schema migrations at startup
   and prevents startup when connection/migration setup fails. Do not point an
   older image at a database already migrated by a newer image unless that
   rollback path has been explicitly tested. If a later application version
   must be used, follow its documented upgrade path and test it against a
   restorable copy first; do not assume schema downgrade support.
5. Complete the checks below before returning the service to normal operation.

Keep a pre-restore backup of the destination when feasible under the
operator's change and retention policy. Never overwrite the only recoverable
copy while diagnosing a failed restore.

## Verify after restore

- Confirm the server is ready and remains connected to the restored
  application-owned database; check logs for migration errors without
  including connection strings or credentials.
- Confirm expected reminder configuration and delivery-state rows are present
  using approved database administration tools. Avoid dumping sensitive row
  contents into logs or tickets.
- Confirm the restored `/app/storage` mount is the intended claim and that the
  bot can read/write the state it needs. If persistence was disabled, verify
  expected startup behavior with empty ephemeral storage.
- Confirm the deployment references the intended Secret name/key and
  application-owned database. Do not print the Secret value during checks.
- Separately confirm Radicale is healthy and its canonical calendars and
  events are present. Restoring the app database or PVC cannot recover missing
  CalDAV objects.
- Before resuming any future reminder scheduler, reconcile reminder
  configuration against current CalDAV event, recurrence, and alarm identities
  and review delivery history for the chosen recovery point. A database restore
  can roll back delivery claims or sent state; Matrix delivery is at-least-once
  and may produce duplicate notifications after recovery. Do not promise
  exactly-once delivery.
- Record the restore point, image/chart versions, checks performed, and any
  accepted data loss or notification replay risk in the protected operational
  record.

Schedule a restore exercise periodically according to the operator's policy.
An untested backup is not evidence that the deployment can be recovered.
