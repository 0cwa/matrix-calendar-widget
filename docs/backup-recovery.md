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

The volume capture below is a cold, consistent copy. The recommended off-host
storage layer is a Restic repository on S3-compatible storage. Restic encrypts
and deduplicates the captured files; the repository password must be kept
separately from the repository. The project does not ship a backup script or
systemd unit. An operator may schedule a host-local coordinator as described
below, after validating it on that host. No S3 provider, scheduled run, or
production recovery path has been validated here. No live etke deployment or
etke data recovery path has been verified.

## Restic repository and daily schedule

Use a pinned Restic release and [verify the official binary checksums and
signature](https://restic.readthedocs.io/en/stable/developer_information.html#verifying-the-official-binaries)
before installing it. These examples target Restic 0.19.1. See the [Restic S3
backend and credential options](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html#s3-compatible-storage),
[password and repository configuration](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html),
[Restic environment variables](https://restic.readthedocs.io/en/stable/075_scripting.html),
[snapshot tags and scheduling](https://restic.readthedocs.io/en/stable/040_backup.html#scheduling-backups),
and [retention and pruning](https://restic.readthedocs.io/en/stable/060_forget.html).

Choose one stable S3 repository URL with a dedicated bucket prefix, for example
`s3:https://<s3-endpoint>/<bucket>/<matrix-calendar-repository>`. The endpoint,
bucket, and prefix are configuration, not credentials; keep the same repository
path for every run and restore. Supply S3 credentials using the provider's
supported secret mechanism. Restic supports an AWS shared-credentials file via
`AWS_SHARED_CREDENTIALS_FILE`; do not put access keys or passwords in the
repository URL, command arguments, shell history, unit files, or logs. Supply
the Restic password through `RESTIC_PASSWORD_FILE`, using a protected runtime
credential file. Keep an independently controlled recovery copy of that
password outside the host and S3 account; losing it makes the repository
unrecoverable. This process does not require a Matrix user's password.

For systemd, a host-local service can use [`LoadCredential=`](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#Credentials)
to provide the
password and S3 shared-credentials file as read-only runtime files, then set
`RESTIC_PASSWORD_FILE=%d/restic-password`,
`AWS_SHARED_CREDENTIALS_FILE=%d/s3-credentials`, and
`RESTIC_REPOSITORY=<the-stable-repository-url>` in the service environment.
Use the host's secret store for the credential sources. Do not put secret values
in `Environment=` or `EnvironmentFile=`. Initialize the repository once from a
protected operator session using that same configuration, and retain the
repository password separately for recovery. Run `restic init` once with that
protected configuration; do not put secret values on its command line.

An illustrative unit pair can call an operator-maintained coordinator:

```ini
# /etc/systemd/system/matrix-calendar-backup.service
[Unit]
Description=Cold backup of the Matrix Calendar sidecar

[Service]
Type=oneshot
LoadCredential=restic-password:/secure/operator-credentials/restic-password
LoadCredential=s3-credentials:/secure/operator-credentials/s3-credentials
Environment=RESTIC_PASSWORD_FILE=%d/restic-password
Environment=AWS_SHARED_CREDENTIALS_FILE=%d/s3-credentials
Environment=AWS_PROFILE=default
Environment=RESTIC_REPOSITORY=s3:https://<s3-endpoint>/<bucket>/<matrix-calendar-repository>
ExecStart=/usr/local/sbin/matrix-calendar-cold-backup
```

```ini
# /etc/systemd/system/matrix-calendar-backup.timer
[Unit]
Description=Run the Matrix Calendar cold backup daily

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=15m
Unit=matrix-calendar-backup.service

[Install]
WantedBy=timers.target
```

Protect the credential source files with host-appropriate permissions. The S3
credentials file uses the standard shared-credentials format. The coordinator
path is an operator-managed script; the example unit does not install or supply
that script. Validate its failure handling, service restart behavior, and
systemd credential support on the target host before enabling the timer.

After the cold archives and any PostgreSQL dump are complete, the coordinator
should back up the completed backup directory under one stable host identity and
stable tags, for example:

```bash
restic backup --host matrix-calendar-sidecar --tag matrix-calendar-sidecar \
  --tag cold-paired-store --group-by host,tags "$BACKUP_DIR"
```

The capture directory name contains a backup timestamp, so `host,tags` is set
for both backup and retention; otherwise each dated source path would form a
separate retention group. Keep the repository prefix, host identity, and both
tags stable for this deployment.

Scope retention to that identity and tag pair. First review the proposed
deletions with `--dry-run`; only after confirming the selection, schedule the
same command without `--dry-run` and with `--prune`:

```bash
restic forget --host matrix-calendar-sidecar \
  --tag matrix-calendar-sidecar,cold-paired-store \
  --group-by host,tags --keep-daily 30 --dry-run
```

After reviewing the preview, use the same scope and policy without dry-run and
with pruning enabled:

```bash
restic forget --host matrix-calendar-sidecar \
  --tag matrix-calendar-sidecar,cold-paired-store \
  --group-by host,tags --keep-daily 30 --prune
```

This policy keeps one point for each of up to 30 days with a successful backup.
A missed timer run leaves a gap; the timer does not guarantee a daily recovery
point. Pruning can lock the repository while it runs, so schedule it where it
will not overlap a backup. Check the repository periodically and alert on
service failure or incomplete backup results. Run `restic check` periodically
to check repository structure.

Restic does not schedule itself. A host operator can install the example systemd
oneshot service and daily timer to invoke a private host-local coordinator.
That coordinator must perform the existing quiesce, capture, verification,
Restic upload, and restart steps as one failure-aware run: stop new widget
requests and all Radicale/server writers, coordinate the PostgreSQL dump if
enabled, do not upload a partial capture, and restart the services even if a
later step fails. Restart after the local capture is complete, before the S3
upload; preserve the capture and report failure if upload or retention fails.
Treat Restic's incomplete-backup result as a failed recovery point even if it
created a snapshot. Prevent overlapping runs and make failures visible to the
operator. The repository provides neither that coordinator nor systemd units;
timer installation and daily execution remain host responsibilities.

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
# Set explicitly from deployment configuration; do not leave this placeholder.
REMINDER_DB_BACKUP_ENABLED=replace-with-true-or-false
PG_SERVICE=matrix-calendar-reminder
mkdir -p "$(dirname "$BACKUP_DIR")"
mkdir -m 0700 "$BACKUP_DIR"
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
its backup in this same maintenance window as described below. Stop the calendar
server while the database dump is made, and keep the custom-format dump inside
`BACKUP_DIR` so the volume archives and database dump enter the same Restic
snapshot. CalDAV and PostgreSQL do not provide a cross-store atomic snapshot.
Never copy PostgreSQL's live data directory. Do not include the database URL, a
password file, Matrix tokens, or resolved Compose configuration in the capture
directory.

While all writers remain stopped, capture the optional reminder database before
archiving the volumes. Set `REMINDER_DB_BACKUP_ENABLED` explicitly to `true`
when `MATRIX_CALENDAR_REMINDER_DATABASE_URL` is configured, and to `false` only
when the reminder database is not configured. The private libpq service named
by `PG_SERVICE` must resolve the database connection without putting a URL or
password in this shell, command line, or log:

```bash
case "$REMINDER_DB_BACKUP_ENABLED" in
  true)
    PGSERVICE="$PG_SERVICE" pg_dump --format=custom \
      --file="$BACKUP_DIR/reminder-postgresql.dump.partial"
    test -s "$BACKUP_DIR/reminder-postgresql.dump.partial"
    PGSERVICE="$PG_SERVICE" pg_restore --list \
      "$BACKUP_DIR/reminder-postgresql.dump.partial" >/dev/null
    mv "$BACKUP_DIR/reminder-postgresql.dump.partial" \
      "$BACKUP_DIR/reminder-postgresql.dump"
    ;;
  false)
    if [ -e "$BACKUP_DIR/reminder-postgresql.dump" ] || \
       [ -e "$BACKUP_DIR/reminder-postgresql.dump.partial" ]; then
      echo "Unexpected PostgreSQL dump in a no-database capture" >&2
      exit 1
    fi
    ;;
  *)
    echo "Set REMINDER_DB_BACKUP_ENABLED explicitly to true or false" >&2
    exit 1
    ;;
esac
```

If the enabled branch fails, stop the capture: do not mark it complete or upload
a Restic snapshot. The coordinator must keep its restart trap active across
this check and restart the services on failure. For a manual run, restart the
normal project after aborting the capture. The unique `BACKUP_DIR` and explicit
no-database branch prevent an earlier dump or partial file from being mistaken
for the current run's paired backup.

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

case "$REMINDER_DB_BACKUP_ENABLED" in
  true)
    test -s "$BACKUP_DIR/reminder-postgresql.dump"
    sha256sum "$BACKUP_DIR/reminder-postgresql.dump" >> "$BACKUP_DIR/SHA256SUMS"
    ;;
  false)
    test ! -e "$BACKUP_DIR/reminder-postgresql.dump"
    test ! -e "$BACKUP_DIR/reminder-postgresql.dump.partial"
    ;;
  *)
    echo "Set REMINDER_DB_BACKUP_ENABLED explicitly to true or false" >&2
    exit 1
    ;;
esac

docker run --rm \
  --mount "type=bind,source=$(realpath "$BACKUP_DIR"),target=/backup,readonly" \
  busybox:1.37.0 sh -c \
  'tar -tf /backup/radicale-data.tar >/dev/null 2>&1 && tar -tf /backup/server-data.tar >/dev/null 2>&1'
```

Use an archive tool and extraction mode that preserve file contents, directory
structure, symlinks, permissions, and numeric ownership for the volume. Verify
the archives can be read and retain the checksum manifest with them. Do not
publish archive listings: calendar objects and Matrix SDK state may contain
sensitive data.

After both archives and checksums are verified, restart the normal project:

```bash
docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d
```

Record the backup time, Compose project name, source revision/image identifiers,
archive checksums, and any separately backed-up database's recovery point in
the operator's protected backup record. Do not record secrets or event data.
After the local capture is complete, upload `BACKUP_DIR` to the configured
Restic repository using the stable host and tags described above. First review
the retention preview; only then enable automatic pruning. Keep the local
capture until Restic reports a complete snapshot. A successful upload does not
prove that the files can be restored or that the S3 service meets a durability
target.

## Restore into an isolated Compose project

Never extract a recovery archive over the active production volumes. Restore on
a separate Docker host/context when possible. For every restore attempt, choose
a unique Compose project suffix that has never been used on that Docker daemon.
Compose will create fresh, isolated volumes with the same logical names and
that unique project prefix:

```bash
set -euo pipefail
BACKUP_ID=replace-with-backup-id
BACKUP_DIR="/secure/off-host-backups/matrix-calendar/$BACKUP_ID"
RESTORE_ID=replace-with-unique-lowercase-restore-id
RESTORE_PROJECT="matrix-calendar-sidecar-restore-$RESTORE_ID"
```

For example, a unique lowercase `RESTORE_ID` of `20261003t120000z-a81c2f`
creates `matrix-calendar-sidecar-restore-20261003t120000z-a81c2f_radicale-data`
and `matrix-calendar-sidecar-restore-20261003t120000z-a81c2f_server-data`. Do
not reuse a restore project name, even on an isolated host. Verify the checksum
manifest and prove both destination volume names are absent before creating
them:

```bash
set -euo pipefail
(cd "$BACKUP_DIR" && sha256sum --check SHA256SUMS)
for suffix in radicale-data server-data; do
  volume="${RESTORE_PROJECT}_$suffix"
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    echo "Refusing to reuse existing restore volume: $volume" >&2
    exit 1
  fi
done
docker volume create "${RESTORE_PROJECT}_radicale-data"
docker volume create "${RESTORE_PROJECT}_server-data"

# Each check is read-only and must succeed before extraction proceeds.
docker run --rm \
  --mount "type=volume,source=${RESTORE_PROJECT}_radicale-data,target=/restore" \
  busybox:1.37.0 sh -c 'test -z "$(ls -A /restore)"'
docker run --rm \
  --mount "type=volume,source=${RESTORE_PROJECT}_server-data,target=/restore" \
  busybox:1.37.0 sh -c 'test -z "$(ls -A /restore)"'

# Repeat the empty-directory check in the same container immediately before
# each extraction, so an existing file causes the restore to stop.
docker run --rm \
  --mount "type=volume,source=${RESTORE_PROJECT}_radicale-data,target=/restore" \
  --mount "type=bind,source=$(realpath "$BACKUP_DIR"),target=/backup,readonly" \
  busybox:1.37.0 sh -c 'test -z "$(ls -A /restore)" && cd /restore && tar -xpf /backup/radicale-data.tar'

docker run --rm \
  --mount "type=volume,source=${RESTORE_PROJECT}_server-data,target=/restore" \
  --mount "type=bind,source=$(realpath "$BACKUP_DIR"),target=/backup,readonly" \
  busybox:1.37.0 sh -c 'test -z "$(ls -A /restore)" && cd /restore && tar -xpf /backup/server-data.tar'
```

Use a staging environment file, not the production one. Point the isolated
project at a test Matrix homeserver and disposable bot credentials, and provide
an isolated external PostgreSQL database if the reminder store was enabled.
Do not start the restored copy against the production homeserver, production
database, public hostnames, or production proxy network during validation.
If PostgreSQL is enabled, restore its custom-format dump into the isolated
staging database and restore required roles and grants before starting the
project. See the separate PostgreSQL guidance below.
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

Restore the selected Restic snapshot into a new, empty staging directory first;
never restore over an active production capture directory. Verify the restored
`SHA256SUMS` manifest before extracting either volume archive or using the
PostgreSQL dump. Supply the repository path, S3 credentials, and Restic
password through the protected recovery environment; do not copy them into the
restore command or logs. List snapshots with `restic snapshots` and select the
intended backup by its stable host, tags, and recovery time:

```bash
RESTORE_STAGING_DIR=/secure/restore-staging/matrix-calendar
SNAPSHOT_ID=replace-with-listed-snapshot-id
mkdir -m 0700 "$RESTORE_STAGING_DIR"
restic restore "$SNAPSHOT_ID" --target "$RESTORE_STAGING_DIR"
```

Restic restores the snapshot's saved paths below the target directory. Locate
the captured backup directory there, then run the checksum and isolated-volume
steps below against that directory.

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
4. If PostgreSQL is enabled, validate reminder-service startup/migration
   behavior against the isolated staging database. Do not send real Matrix
   reminders from a recovery test.
5. After validation, remove only resources bearing the unique restore project
   name. First stop and remove that Compose project's containers and network,
   then remove only its two named volumes. Do not use `docker system prune` or
   other broad cleanup commands:

   ```bash
   docker compose --project-name "$RESTORE_PROJECT" --env-file deploy/.env.restore -f deploy/etke-sidecar.compose.yaml down
   docker volume rm "${RESTORE_PROJECT}_radicale-data" "${RESTORE_PROJECT}_server-data"
   ```

   Preserve the original production volumes and verified backup until the
   operator accepts the recovery result.

Record pass/fail, elapsed restore time, volume/archive checksums, source image
identifiers, and any data or permission discrepancies. A successful test of
these project-owned volumes does not validate the separate etke-managed
Radicale service or its data.

## Optional external PostgreSQL store

The optional reminder database configured by
`MATRIX_CALENDAR_REMINDER_DATABASE_URL` is external to the Compose volumes. The
enabled capture branch above creates its custom-format dump while the writers
are stopped, validates it with `pg_restore --list`, and requires it in the
checksum manifest before the capture can complete. The dump is included in the
same Restic snapshot as the volume archives. It does not replace the separate
protected role and grant recovery procedure. See the [PostgreSQL `pg_dump`
documentation](https://www.postgresql.org/docs/current/app-pgdump.html) and
[`pg_restore` documentation](https://www.postgresql.org/docs/current/app-pgrestore.html).
Keep database credentials and dumps protected. The application does not provide
a single atomic transaction across CalDAV files and PostgreSQL.

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
