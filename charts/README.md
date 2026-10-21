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

The server chart uses `/v1/health/live` for Kubernetes liveness. This endpoint
reports only that the server process can answer HTTP requests, so a temporary
homeserver outage does not restart the gateway. Readiness and the chart's
connection test use `/v1/health`, which checks the configured homeserver and
returns its failure status when that dependency is unavailable. These probes
do not verify a production deployment.

Render and verify the two deployment probe paths with:

```sh
charts/matrix-calendar-server/tests/health-probe-paths.test.sh
```

No chart in this repository publishes to a Nordeck registry or namespace.
