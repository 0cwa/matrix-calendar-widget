# Matrix Calendar Helm charts

These charts are retained from the upstream meeting-widget baseline and have been renamed for this fork.

> **Pre-alpha:** chart publishing is intentionally disabled. Treat these as deployment scaffolding until M8 validates the final gateway configuration and release process.

## Charts

- `matrix-calendar` — umbrella chart.
- `matrix-calendar-widget` — widget web application.
- `matrix-calendar-server` — the current gateway and bot deployable.

The calendar gateway is implemented in the server. Configure its Matrix and
Radicale endpoints through `matrix-calendar-server.settings.additionalEnv`;
see [`docs/configuration.md`](../docs/configuration.md) for the supported
settings. The final delegated OpenID-to-Radicale contract still depends on
external plugin work, so the charts remain pre-alpha deployment scaffolding,
not a verified pilot release configuration.

No chart in this repository publishes to a Nordeck registry or namespace.

## Reminder database boundary

ADR019 selects a separate application-owned PostgreSQL database and
least-privilege role for future Matrix reminder sidecar configuration and
delivery state. Operators may use an existing PostgreSQL cluster, but must
provision a distinct calendar database and role; the app must never use
Synapse's database, schema, role, or `pg-credentials` initialization Secret.
The chart does not provision PostgreSQL or create the credentials Secret.

`matrix-calendar-server.reminders.enabled` defaults to `false`. To prepare a
future reminder deployment, create an external Kubernetes Secret containing
the full connection URL and set `reminders.databaseUrl.existingSecret` plus
`existingSecretKey`. The chart injects
`MATRIX_CALENDAR_REMINDER_DATABASE_URL` only when enabled; a missing Secret or
key prevents the pod from starting. Do not place the URL in Helm values or
`settings.additionalEnv`. This is deployment scaffolding only: reminder
scheduling, durable claims, delivery-time room permissions, and database
migrations are not implemented by this chart change. Restart the server
deployment after rotating the external Secret, because environment variables
are read when the pod starts.

The existing `persistence.enabled` setting controls the server's `/app/storage`
filesystem volume for bot state. It remains `false` by default and is unchanged;
that PVC is separate from PostgreSQL reminder durability. Keep
`replicaCount: 1` by default. Database coordination alone does not make the
Matrix bot state/authentication path safe for multiple app replicas.
