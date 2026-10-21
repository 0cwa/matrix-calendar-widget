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

When [public calendar feeds](./adrs/adr045-public-calendar-feeds.md) are
enabled, Radicale 3.8.0 stores native share tokens below
`/data/collections/collection-db/files/token`, within the complete `radicale-data`
volume captured here. Preserve the configured public-feed signing key in the
same protected recovery point: if the key is file-backed, add the exact key
file to the encrypted `restoreInputs` allowlist; if it comes from an environment
file, include that file only where secret-backup policy permits. The signing
key is required to keep existing signed URLs valid after recovery. Restoring
the Radicale volume without its matching key, or the key without the matching
volume, does not preserve those URLs. Keep the signing key in separate secret
custody from the Restic repository password and object-store credentials.

The volume capture below is a cold, consistent copy. The recommended off-host
storage layer is a Restic repository on S3-compatible storage. Restic encrypts
and deduplicates the captured files; the repository password must be kept
separately from the repository. The project now ships a host-local coordinator
and generic systemd service/timer templates. The templates are examples only:
they are not installed or enabled by the project. No S3 provider, scheduled
run, or production recovery path has been validated here. No live etke
deployment or etke data recovery path has been verified.

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
`AWS_SHARED_CREDENTIALS_FILE=%d/s3-credentials` in the service environment.
The coordinator reads the non-secret repository URL and region from its
operator-owned JSON configuration. Use the host's secret store for credential
sources. Do not put secret values in `Environment=` or `EnvironmentFile=`.
Initialize the repository once from a protected operator session using that
same configuration, and retain the repository password separately for
recovery. Run `restic init` once with that protected configuration; do not put
secret values on its command line.

The generic examples are
[`matrix-calendar-backup.service.example`](../deploy/systemd/matrix-calendar-backup.service.example)
and
[`matrix-calendar-backup.timer.example`](../deploy/systemd/matrix-calendar-backup.timer.example).
Copying, editing, installing, and enabling them are operator actions. They
require host-specific paths, a service account with access to the local Docker
socket, and protected credential sources. Docker socket access is effectively
root-equivalent; grant it only to the account that owns this backup job.

Protect the credential source files with host-appropriate permissions. The S3
credentials file uses the standard shared-credentials format. The project
supplies the coordinator at
[`scripts/matrix-calendar-cold-backup.mjs`](../scripts/matrix-calendar-cold-backup.mjs);
copying it to the service's `ExecStart=` path remains an operator action. The
example unit does not install the script. Validate its failure handling,
service restart behavior, and systemd credential support on the target host
before enabling the timer.

After the cold archives and any PostgreSQL dump are complete, the coordinator
backs up the completed backup directory under one stable host identity and
stable tags, for example:

```bash
restic backup --host matrix-calendar-sidecar --tag matrix-calendar-sidecar \
  --tag cold-paired-store --group-by host,tags "$BACKUP_DIR"
```

The capture directory name contains a backup timestamp, so `host,tags` is set
for both backup and retention; otherwise each dated source path would form a
separate retention group. Keep the repository prefix, host identity, and both
tags stable for this deployment. The coordinator defaults to backup-only when
`resticRetentionEnabled` is absent or `false`. Before enabling it, review the
proposed selection against the exact configured repository, host, and tag pair:

```bash
restic forget --host matrix-calendar-sidecar \
  --tag matrix-calendar-sidecar,cold-paired-store \
  --group-by host,tags --keep-daily 30 --dry-run
```

With `resticRetentionEnabled: true`, the coordinator runs the same filters and
grouping after a successful upload, replacing `--dry-run` with `--prune`:

```bash
restic forget --host matrix-calendar-sidecar \
  --tag matrix-calendar-sidecar,cold-paired-store \
  --group-by host,tags --keep-daily 30 --prune
```

The fixed policy keeps one recovery point for each of up to 30 recent
populated calendar dates. A missed timer run leaves a gap: it creates no point
for that date, so the policy does not guarantee 30 snapshots or 30 elapsed days
of coverage. The oldest retained point can be more than 30 elapsed days old.

The host filter and one comma-joined tag pair select the snapshots eligible
for forgetting; both tags in that pair must match. Restic's `--prune` then
performs repository-wide garbage collection: it scans snapshots and repository
data, removes data no remaining snapshot references, and may repack partially
used pack files. It preserves data referenced by retained snapshots, including
foreign snapshots, but prune can read, remove, or rewrite repository data
beyond this project's snapshot set. The dry run above previews the forget
selection; it does not bound prune's repository-wide scan or repacking.

The coordinator runs prune after forgetting so unreferenced data does not
accumulate. Automatic pruning therefore requires repository-wide maintenance
authority and a budget for S3 reads, writes, and deletes. Plan a dedicated
repository or S3 prefix for the pilot. Keep retention disabled on a shared
repository unless the operator has explicitly approved repository-wide prune
activity. When using a shared repository, choose a Compose `projectName`
unique to this deployment; automatic retention requires `resticHost` and one
configured tag to equal that project name. Invalid or missing scope fails
configuration validation before any command runs. A retention failure exits
the service as a retention-stage failure even though the backup completed;
the local capture and uploaded snapshot remain available for inspection.
Check the repository periodically and alert on service failure or incomplete
backup results. Run `restic check` periodically to check repository structure.

Restic does not schedule itself. A host operator may install the example
oneshot service and daily timer to invoke the shipped coordinator after local
validation. Its daily timer can run a backup each day, while successful daily
recovery points still depend on the service and target being available. The
example timer is not enabled by the project. Keep automatic retention off for
an initial deployment until the exact target selection, credentials, and
isolated restore have been reviewed.

## Use the shipped host-local coordinator

Install the script at the path used by the service template, or edit
`ExecStart=` to the reviewed local path. Create a mode-0600 JSON configuration
file owned by the service account. It must explicitly set the Compose project
directory and private interpolation env file, an existing mode-0700 capture
directory owned by that account, the local Docker socket, a reviewed helper image pinned by digest,
the S3 repository and region, the stable Restic host and two stable tags, and
whether the reminder database is enabled. The systemd service must also
provide a private writable Restic cache directory. Keep the repository URL generic until
the operator selects an endpoint, bucket, prefix, and region; never include
userinfo, query strings, or credentials in it.

For example, this shape contains no credentials and is not directly runnable
until its placeholders and host paths are replaced:

```json
{
  "projectName": "matrix-calendar-sidecar",
  "projectDirectory": "/opt/matrix-calendar-widget",
  "composeEnvFile": "/etc/matrix-calendar/sidecar.env",
  "captureRoot": "/var/backups/matrix-calendar",
  "dockerSocket": "/var/run/docker.sock",
  "helperImage": "busybox:1.37.0@sha256:<reviewed-image-digest>",
  "reminderDatabaseEnabled": false,
  "pgService": null,
  "repository": "s3:https://<s3-endpoint>/<bucket>/<prefix>",
  "awsRegion": "<selected-region>",
  "awsProfile": "default",
  "resticHost": "matrix-calendar-sidecar",
  "resticTags": ["matrix-calendar-sidecar", "cold-paired-store"],
  "resticRetentionEnabled": false,
  "cleanupSuccessfulCapture": false,
  "restoreInputs": [
    {
      "name": "deployment-compose",
      "path": "/etc/example-calendar/compose.yaml"
    },
    { "name": "deployment-env", "path": "/etc/example-calendar/deployment.env" }
  ]
}
```

`restoreInputs` is optional for older configurations. When used, it is an
explicit allowlist of at most 32 named regular files; each file is limited to
4 MiB and their combined size to 16 MiB. The coordinator rejects missing files,
symlinks, duplicate names or paths, group/other-writable files, and files it
cannot safely read. It copies each input to a deterministic flat filename in
the existing private capture directory with mode `0600`, records its exact
source path, owner IDs, original mode, byte count, and SHA-256 in the encrypted
capture manifest, and adds the copy to the normal checksum set. It verifies
that sources did not change during capture or Restic upload and verifies the
snapshot's manifest and input bytes through Restic readback. No input contents
or private metadata are printed by the coordinator.

List every host file needed to recreate the selected deployment, including
runtime credential files where policy permits their encrypted backup. Keep
the Restic repository password and cloud repository access credentials under
independent recovery custody; they are needed to open the snapshot and cannot
be recovered from it. Never capture or store a user's Matrix password. Restore
inputs are recovered to a new staging directory and inspected there. The
coordinator does not write them back to their original live paths.

When the reminder database is enabled, the coordinator keeps `native` as the
default `postgresDumpTransport`: it uses the host's PostgreSQL client and the
protected libpq service and password files described below. An operator may
instead opt into `container-exec` for a database that accepts passwordless
local-socket authentication. In that mode, add an explicit `postgresContainer`
object with the exact Compose project and service labels, an image reference
pinned by digest, and the database and role names used for the dump. For
example, merge these fields into the configuration above and set
`pgService` to `null`:

```json
{
  "reminderDatabaseEnabled": true,
  "pgService": null,
  "postgresDumpTransport": "container-exec",
  "postgresContainer": {
    "projectName": "calendar-database",
    "serviceName": "database",
    "image": "postgres:<tag>@sha256:<reviewed-image-digest>",
    "database": "<database-name>",
    "username": "<dump-role>"
  }
}
```

The coordinator requires exactly one running container with those Compose
labels, verifies its configured image reference and immutable local image ID,
and checks that the same container remains running before and after the dump.
It runs `pg_dump` over the container's Unix socket with a clean environment,
`--no-password`, an explicit database and role, and `/dev/null` passfile and
service-file paths. Inherited PostgreSQL environment settings cannot redirect
the dump or supply credentials.
The database's local authentication rules must permit that connection; if they
require a password or use peer authentication incompatible with the configured
role, retain the native transport. Both transports produce the same custom
format dump, which the host `pg_restore --list` checks before the capture is
accepted. The checksummed `capture-manifest.json` records whether a dump was
included, its transport and format, and the client and validation-tool
versions, without recording container names or database credentials. The
manifest is additive: recovery of older captures does not require it.

`resticRetentionEnabled` is an opt-in boolean and defaults to `false` when
omitted. Its fixed `--keep-daily 30` policy keeps one recovery point for each
of up to 30 recent populated calendar dates; missed backup days leave gaps and
are not covered. After a successful upload, it also invokes repository-wide
Restic pruning. The `resticHost` and comma-joined `resticTags` scope the
snapshots eligible for forgetting; they do not scope prune's repository scan
or I/O. Enabling it requires `resticHost` and one of the two stable
`resticTags` to match `projectName`. Review the forget dry-run, select a
dedicated pilot repository or S3 prefix, and approve repository-wide prune
authority and I/O budget before enabling it. A shared repository requires
explicit approval for that repository-wide maintenance.

`cleanupSuccessfulCapture` is a separate opt-in boolean and defaults to
`false`. Keep it off until an independent isolated restore has succeeded. When
enabled, the coordinator removes only the current run's marked staging
directory, and only after Restic reports a snapshot ID and bounded readback
confirms that snapshot's ID, host, tags, capture path, expected file entries
and sizes, and exact marker bytes. It also rechecks the private capture-root
and current-directory identities and the staged file set before unlinking the
known files. A failed upload, readback, or local identity check leaves the
capture for inspection. Older, unmarked, or foreign directories are never
swept by this option; it does not delete repository snapshots or change remote
retention.

The Compose env file, Restic password, S3 credentials, and optional PostgreSQL
password are read only through protected paths; none is copied into a capture.
The service template supplies the Restic password and S3 shared-credentials
file with `LoadCredential=` and creates a private Restic cache directory. If
running the coordinator outside systemd, set `RESTIC_CACHE_DIR` to an existing
private directory. If the reminder database is enabled, set
`reminderDatabaseEnabled` to `true`. With the default `native` transport, set
`pgService` to the selected libpq service, configure `PGSERVICEFILE` to a
password-free service definition, and load a protected `.pgpass`-format file
with `LoadCredential=` into `PGPASSFILE`. The coordinator rejects a selected
libpq service containing a `password=` entry. The opt-in `container-exec`
transport does not use those host-side PostgreSQL files; it requires the
passwordless local-socket authentication described above.
Keep an independent recovery copy of the Restic repository password outside
the host and S3 account; the project neither generates nor copies it.

Before writing a capture, the coordinator validates configuration and private
file permissions, the Compose model, the local Docker socket, the pinned helper
image, both project-prefixed volumes, Restic, and the tools required by the
selected PostgreSQL transport. Native mode checks the host `pg_dump`; both
database modes check host `pg_restore`. Container-exec mode also verifies the
exactly labeled running database container, its configured digest reference,
its immutable local image ID, and its in-container `pg_dump` version. The
coordinator also requires exactly one `widget`, `server`, and `radicale`
container to be running. A
missing credential, invalid config, missing helper image, stopped service, or
overlapping run fails closed before service changes. It does not pull images.
It requires all three services to be running at the beginning; it will not
silently start a service that was already stopped.

The coordinator then stops `widget`, `server`, and `radicale`, verifies graceful
stopped state, checks that no running Docker container uses either captured
volume, and captures the explicitly configured PostgreSQL branch and
read-only volume archives into a fresh private directory. It validates the
dump and archives, writes checksums, and rechecks the stopped services before
restarting `radicale`, `server`, and `widget`. It uploads only after every
restart succeeds and the local directory has a `.capture-complete` marker.
Any stop, dump, archive, verification, checksum, or restart failure prevents
upload and leaves an unmarked local directory for operator inspection. Restic
backup failure, including an incomplete-backup result, leaves the verified
local capture marked complete but skips retention and reports an upload-stage
failure. When opt-in retention is enabled, forget/prune runs only after Restic
reports a successful backup; its failure reports a retention-stage failure
without removing the local capture or undoing the uploaded snapshot. If
`cleanupSuccessfulCapture` is enabled, cleanup follows retention and requires
snapshot readback plus a final local identity and file-set check; otherwise the
successful local capture remains. Nonempty diagnostics from the dump,
restore-list, or tar validation commands are treated as a failed capture
stage.

The lock is exclusive and a stale lock is not removed automatically; verify
that no run is active before clearing one. A handled `SIGTERM` or `SIGINT`
attempts to restart all initially running services in dependency order. A
`SIGKILL`, host crash, or power loss can interrupt that cleanup, so check and
start the project services after an interrupted host run. The coordinator can
check Docker volume consumers but cannot detect every host process or external
PostgreSQL writer. Ensure those are quiescent as well. The paired files and
database dump form one recovery point, not a cross-store atomic snapshot.

These templates and synthetic local tests do not establish a working S3
provider, target-host scheduling, off-host upload, or restore. Validate the
coordinator, service restart behavior, credential support, repository access,
and paired restore on the intended host before enabling the timer.

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

While all writers remain stopped, capture the app-owned PostgreSQL database
before archiving the volumes. Set `REMINDER_DB_BACKUP_ENABLED` explicitly to
`true` when either the reminder or binding store is configured and this dump is
to include its database; set it to `false` only when neither store is configured.
The private libpq service named by `PG_SERVICE` must resolve the app-owned
database containing the configured store state, without putting a URL or
password in this shell, command line, or log. For a binding-only installation,
point `PG_SERVICE` at the binding database and enable this dump explicitly.

The binding and reminder stores may share one PostgreSQL database. In that
case, one configured dump includes both owned schemas. This procedure captures
the database selected by `PG_SERVICE`; configuring either URL does not make the
database appear in a capture automatically. If the stores use different
databases, capture each database with a separate protected dump and restore
procedure before relying on both stores.

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
capture until an independent isolated restore has succeeded. A successful
upload does not prove that the files can be restored or that the S3 service
meets a durability target.

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
PostgreSQL dump. When the manifest contains `restoreInputs`, confirm its
entries map only to the expected explicit allowlist, then verify every flat
input copy against `SHA256SUMS`. Use the recorded source path and ownership
metadata only to guide a separate, operator-reviewed staging setup; do not
apply recovered files over a live deployment. Supply the repository path, S3 credentials, and Restic
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
