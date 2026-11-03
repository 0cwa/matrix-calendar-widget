# Matrix Calendar Helm charts

[Project overview](../README.md) · [Deployment](../docs/deployment-docker.md) · [Release policy](../docs/release-versioning.md)

These charts are retained from the upstream meeting-widget baseline and have been renamed for this fork.

> **Pre-alpha:** chart publishing is intentionally disabled. Treat these as deployment scaffolding until M8 validates the final gateway configuration and release process.

## Charts

- `matrix-calendar` — umbrella chart.
- `matrix-calendar-widget` — widget web application.
- `matrix-calendar-server` — the current gateway and bot deployable.

The calendar gateway is implemented in the server. Configure its Matrix and
Radicale endpoints through `matrix-calendar-server.settings.additionalEnv`;
see [`docs/configuration.md`](../docs/configuration.md) for the supported
settings. The project-owned [Radicale OpenID adapter](../radicale-auth/README.md) is
implemented and exercised by the pinned service contracts. These charts do
not provision that independent Radicale store, the application PostgreSQL
stores, public-feed key/ingress, or a verified recovery procedure. They remain
pre-alpha deployment scaffolding. The controlled pilot uses the
[operator-run Compose reference](../docs/deployment-docker.md#operator-run-compose-sidecar-example);
see the [release ledger](../docs/RELEASE.md) for qualified source and evidence.

The server chart uses `/v1/health/live` for Kubernetes liveness and
`/v1/health/ready` for readiness. `/v1/health` and `/v1/health/live` report
that the server process can answer HTTP requests without contacting the
homeserver. `/v1/health/ready` checks the configured homeserver and returns its
failure status when that dependency is unavailable. The chart connection test
uses `/v1/health` to verify the server's local HTTP endpoint. These probes do
not verify a production deployment.

Render and verify the two deployment probe paths with:

```sh
charts/matrix-calendar-server/tests/health-probe-paths.test.sh
```

No chart in this repository publishes to a Nordeck registry or namespace.
