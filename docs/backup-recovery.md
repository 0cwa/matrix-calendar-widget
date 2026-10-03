# Backup and recovery for the operator-run Compose sidecar

This runbook covers only the project-owned named volumes in
[`deploy/etke-sidecar.compose.yaml`](../deploy/etke-sidecar.compose.yaml):

- `radicale-data`, mounted at `/data` in this project's Radicale container;
- `server-data`, mounted at `/app/storage` in the calendar server container.

Compose prefixes these logical volume names with the project name. With the
documented `matrix-calendar-sidecar` project name, the Docker volume names are
`matrix-calendar-sidecar_radicale-data` and
`matrix-calendar-sidecar_server-data`. The server volume contains the
configured Matrix SDK file store and may also contain crypto state if that
feature is enabled. Treat both archives as sensitive, restrict access, and
protect them at rest.

This is an operator-run procedure for a cold, consistent copy. It does not
configure scheduled backups, retention, off-host replication, encryption,
monitoring, or recovery-time objectives. Choose and test those operational
controls for the host before relying on the service. No live etke deployment or
etke data recovery path has been verified.

## Prepare a backup window

Use the same Compose file, project name, and configuration as the deployment.
Keep the resolved Compose configuration and secret-bearing environment files
out of terminal transcripts, shell tracing, backup archives, and version
control. Set the paths below in a private shell; do not paste secret values in
commands or logs:

```bash
set -euo pipefail
umask 077
PROJECT=matrix-calendar-sidecar
COMPOSE_FILE=deploy/etke-sidecar.compose.yaml
ENV_FILE=deploy/.env.local
BACKUP_ID=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="/secure/off-host-backups/matrix-calendar/$BACKUP_ID"
mkdir -p "$BACKUP_DIR"
```

Stop every writer before copying either volume. Stopping the widget also avoids
new user requests while the gateway and Radicale are shutting down:

```bash
docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop widget server radicale
```

Confirm all three services are stopped and that no other container or host
process writes to either volume. If a service will not stop cleanly, do not
archive a live volume and call the result consistent; resolve the shutdown
problem first. If the optional reminder PostgreSQL store is enabled, coordinate
its backup in this same maintenance window as described below. CalDAV and
PostgreSQL do not provide a cross-store atomic snapshot.

## Archive the two volumes

Create archives using a trusted local helper image that includes `tar`; pin or
otherwise control the helper image used by your operations. The helper mounts
each source read-only and writes only to the protected backup directory. Run
this on the Docker host with permission to read the volumes and write the
backup directory:

```bash
docker run --rm \
  --mount "type=volume,source=${PROJECT}_radicale-data,target=/source,readonly" \
  --mount "type=bind,source=$(realpath "$BACKUP_DIR"),target=/backup" \
  busybox:1.37.0 sh -c 'cd /source && tar -cpf /backup/radicale-data.tar.partial .'

docker run --rm \
  --mount "type=volume,source=${PROJECT}_server-data,target=/source,readonly" \
  --mount "type=bind,source=$(realpath "$BACKUP_DIR"),target=/backup" \
  busybox:1.37.0 sh -c 'cd /source && tar -cpf /backup/server-data.tar.partial .'

mv "$BACKUP_DIR/radicale-data.tar.partial" "$BACKUP_DIR/radicale-data.tar"
mv "$BACKUP_DIR/server-data.tar.partial" "$BACKUP_DIR/server-data.tar"

sha256sum "$BACKUP_DIR/radicale-data.tar" "$BACKUP_DIR/server-data.tar" \
  > "$BACKUP_DIR/SHA256SUMS"

docker run --rm \
  --mount "type=bind,source=$(realpath "$BACKUP_DIR"),target=/backup,readonly" \
  busybox:1.37.0 sh -c \
  'tar -tf /backup/radicale-data.tar >/dev/null 2>&1 && tar -tf /backup/server-data.tar >/dev/null 2>&1'
```

Use an archive tool and extraction mode that preserve file contents, directory
structure, symlinks, permissions, and numeric ownership for the volume. Verify
the archives can be read and retain the checksum manifest with them. Store the
backup off the Docker host under the organization's access-control and
retention policy. Do not publish archive listings: calendar objects and Matrix
SDK state may contain sensitive data.

After both archives and checksums are verified, restart the normal project:

```bash
docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d
```

Record the backup time, Compose project name, source revision/image identifiers,
archive checksums, and any separately backed-up database's recovery point in
the operator's protected backup record. Do not record secrets or event data.

## Restore into an isolated Compose project

Never extract a recovery archive over the active production volumes. Restore on
a separate Docker host/context when possible. On the same host, use a distinct
Compose project name so Compose creates isolated volumes with the same logical
names and a different project prefix:

```bash
set -euo pipefail
BACKUP_ID=replace-with-backup-id
BACKUP_DIR="/secure/off-host-backups/matrix-calendar/$BACKUP_ID"
RESTORE_PROJECT=matrix-calendar-sidecar-restore
```

For example, this project uses
`matrix-calendar-sidecar-restore_radicale-data` and
`matrix-calendar-sidecar-restore_server-data`; it does not mount either
production volume. On a separate Docker daemon/context, you may instead use the
original `matrix-calendar-sidecar` project name to create volumes with the
original full names in that isolated daemon. Verify the checksum manifest
before extraction:

```bash
set -euo pipefail
(cd "$BACKUP_DIR" && sha256sum --check SHA256SUMS)
docker volume create "${RESTORE_PROJECT}_radicale-data"
docker volume create "${RESTORE_PROJECT}_server-data"

docker run --rm \
  --mount "type=volume,source=${RESTORE_PROJECT}_radicale-data,target=/restore" \
  --mount "type=bind,source=$(realpath "$BACKUP_DIR"),target=/backup,readonly" \
  busybox:1.37.0 sh -c 'cd /restore && tar -xpf /backup/radicale-data.tar'

docker run --rm \
  --mount "type=volume,source=${RESTORE_PROJECT}_server-data,target=/restore" \
  --mount "type=bind,source=$(realpath "$BACKUP_DIR"),target=/backup,readonly" \
  busybox:1.37.0 sh -c 'cd /restore && tar -xpf /backup/server-data.tar'
```

Use a staging environment file, not the production one. Point the isolated
project at a test Matrix homeserver and disposable bot credentials, and provide
an isolated external PostgreSQL database if the reminder store was enabled.
Do not start the restored copy against the production homeserver, production
database, public hostnames, or production proxy network during validation.
Keep the isolated project name when starting Compose so it continues to use the
restored volumes:

```bash
docker compose --project-name "$RESTORE_PROJECT" --env-file deploy/.env.restore -f deploy/etke-sidecar.compose.yaml config --quiet
docker compose --project-name "$RESTORE_PROJECT" --env-file deploy/.env.restore -f deploy/etke-sidecar.compose.yaml up -d
```

The staging file must define an isolated proxy network already present on the
host. Keep it mode-restricted and never print its resolved Compose config.

## Validate the recovery copy

Validate the restored copy before changing production traffic or deleting any
backup. At minimum:

1. Confirm the isolated Compose services start and reach their expected health
   state without exposing credentials or raw calendar contents in logs.
2. Authenticate with a dedicated staging Matrix test account and confirm a
   known, non-sensitive test calendar and event from the recovery point can be
   read through the widget/gateway. Compare stable identifiers and expected
   availability; avoid copying event titles or attendee data into the recovery
   report.
3. In a dedicated canary calendar, create, read, update, and delete a canary
   event. Confirm the canary operation does not change the recovered calendar
   objects, then remove the canary calendar if appropriate.
4. If PostgreSQL is enabled, validate its isolated restore and the reminder
   service's startup/migration behavior against that staging database. Do not
   send real Matrix reminders from a recovery test.
5. Stop and remove only the isolated project after validation. Preserve the
   original production volumes and verified backup until the operator accepts
   the recovery result.

Record pass/fail, elapsed restore time, volume/archive checksums, source image
identifiers, and any data or permission discrepancies. A successful test of
these project-owned volumes does not validate the separate etke-managed
Radicale service or its data.

## Optional external PostgreSQL store

The optional reminder database configured by
`MATRIX_CALENDAR_REMINDER_DATABASE_URL` is external to the Compose volumes. It
is not included in either archive. Use the database operator's supported
PostgreSQL backup procedure to create and verify a separate backup, including
the required schema/data and the separately managed roles or grants needed by
the application. Keep database credentials and dumps protected. Coordinate
the database recovery point with the cold volume backup by stopping the
calendar server while both are captured; the application does not provide a
single atomic transaction across CalDAV files and PostgreSQL.

Restore PostgreSQL into an isolated staging database before restoring or
starting the sidecar against it. The production server requires verified TLS
by default; configure the staging endpoint and its certificate according to
the deployment's normal secret and CA handling. Do not reuse Synapse's database,
role, schema, or credentials. See [Docker deployment notes](./deployment-docker.md#optional-reminder-postgresql-database)
for the database configuration boundary.

## Explicit exclusions

This procedure does not back up or restore an etke-managed Radicale
installation, its bind-mounted `/data`, or any other etke-managed service data.
The sidecar's `radicale-data` volume is an independent project-owned store; it
is not a verified replacement for, attachment to, or migration of etke's
`/data`. Do not mount, overwrite, convert, or remove that external data as part
of this runbook. Its backup and recovery procedure must be verified separately
with the operator responsible for that deployment.
