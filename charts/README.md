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
