# ADR021: Verify PostgreSQL transport by default

- Status: Accepted
- Date: 2026-09-27

## Context

ADR019 adds an optional application-owned PostgreSQL connection. Database
credentials and reminder state are sensitive, so the server needs a transport
policy that does not silently downgrade to plaintext. The pinned Postgres.js
driver is version 3.4.5.

## Decision

1. Use Postgres.js `ssl: 'verify-full'` by default. Node.js validates the
   certificate chain through its system trust store and checks the endpoint
   name. A TLS or verification error prevents startup; do not retry without
   TLS.
2. For a single IP-literal URL host in `verify-full` mode, pass that IP as the
   Node TLS verification host with `rejectUnauthorized: true`. Postgres.js
   omits SNI for IP literals; Node still verifies the certificate against the
   supplied IP. Its URL parser splits host strings on colons, so pass
   single-entry `host` and `port` arrays for bracketed IPv6 targets in either
   TLS mode, preserving the socket target even when TLS is explicitly disabled.
   Reject multi-host URLs containing an IP literal in `verify-full` mode until
   per-host verification is defined.
3. Permit plaintext only when the operator explicitly sets
   `MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE=trusted-private-network`. This
   mode is for an operator-controlled, isolated database network and sets
   `ssl: false`. It is not an automatic fallback. The CI PostgreSQL service may
   set this exception only for its disposable localhost database.

## Consequences

- Production deployments need a certificate trusted by Node.js whose DNS name
  or IP subject alternative name matches the configured endpoint. This
  repository does not configure a custom CA bundle.
- Configuration tests construct the pinned Postgres.js client without opening
  a socket to ensure IPv6 host and port targets survive its URL parser. The
  local TLS probe covers IPv4 IP-SAN verification. No production or hosted TLS
  endpoint has been validated; the disposable CI PostgreSQL service uses the
  explicit private-network exception.
