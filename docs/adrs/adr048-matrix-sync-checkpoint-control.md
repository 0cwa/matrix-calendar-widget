# ADR048: Persist and expose a bounded Matrix sync checkpoint for backups

- Status: Accepted for the Matrix sync checkpoint slice; full online backup remains open.
- Date: 2026-10-30.
- Issue: [#442](https://github.com/0cwa/matrix-calendar-widget/issues/442).

## Context

The bot's Matrix SDK persists sync state in `bot.json`. A backup must not treat
that state as safe while an event batch is being processed or after an
application listener failed. A host-side backup coordinator also needs a
bounded way to ask the running server to pause Matrix sync during capture.

## Decision

The server writes a `pending` checkpoint state atomically before each Matrix
`/sync` request. After the response's event listeners complete successfully,
the server records `processed`. The storage provider changes `processed` to
`safe` in the same atomic replacement that persists the next sync token. This
keeps the checkpoint state and cursor together if the process exits between
handling the response and saving the cursor. A processing failure records
`unsafe`; if that write fails, the durable `pending` state still blocks
checkpoint acquisition after restart. If the write-ahead `pending` update
itself fails, the client does not issue that sync request. Unknown, pending,
and unsafe states all fail closed for checkpoint acquisition. Legacy stores
that have a cursor but no checkpoint state require operator review. There is no
API to clear an unsafe state; operator recovery or explicit state review is
required.

An optional loopback-only HTTP control surface supports lease acquire, verify,
and release. It requires a dedicated `MATRIX_CHECKPOINT_CONTROL_TOKEN` of at
least 32 characters, sent in `X-Matrix-Checkpoint-Token`, and is disabled when
the variable is unset. It never consumes the standard `Authorization` header.
The control
surface refuses operation when Matrix crypto is enabled. Leases have a
30-second acquisition timeout and a 120-second maximum hold time. A lost,
expired, or restarted lease invalidates the capture; the coordinator must
verify the lease after capture before accepting the result.

The server does not publish a host port for this route. A coordinator on the
host can invoke it through `docker exec` and Node's built-in `fetch` against
`127.0.0.1:3000` inside the server container; the secret remains in the
container environment and never needs to appear in command arguments.

The control surface fences Matrix sync only. It does not stop or drain gateway
writes, PostgreSQL reminder/binding/private-client updates, scheduled jobs, or
Radicale writes. It is a prerequisite for a later coordinator, not a complete
cross-store snapshot protocol. The established cold-backup path remains the
recovery path until a separate all-store coordinator and isolated restore are
implemented and verified.

## Consequences

- Marker-write failure after a request cannot be mistaken for a clean
  checkpoint: the write-ahead state remains `pending` or the committed state
  is `unsafe`.
- Sync continues after application listener failures to preserve normal bot
  behavior; checkpoint acquisition stays denied until explicit operator
  recovery.
- The controller adds a secret-protected loopback route. The secret is never
  accepted from `Authorization`, query strings, or request bodies, and request
  logging excludes the route.
- Enabling this endpoint does not authorize or implement online backup,
  deployment changes, production use, or restore claims.

## Rejected alternatives

- An in-memory-only failure flag is lost on restart.
- A marker written only after failure can itself fail before reaching durable
  storage.
- A coordinator-side Radicale lock alone cannot fence Matrix sync or the
  application's database writers.
