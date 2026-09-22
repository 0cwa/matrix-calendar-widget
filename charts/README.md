# Matrix Calendar Helm charts

These charts are inherited from NeoDateFix and have been renamed for this fork.

> **Pre-alpha:** chart publishing is intentionally disabled. Treat these as deployment scaffolding until M8 validates the final gateway configuration and release process.

## Charts

- `matrix-calendar` — umbrella chart.
- `matrix-calendar-widget` — widget web application.
- `matrix-calendar-server` — current server/bot deployable, which will evolve into the calendar gateway and notification service.

The server still contains inherited meeting-room configuration during the migration. New CalDAV/Radicale settings will be added behind the gateway work in M2.

No chart in this repository publishes to a Nordeck registry or namespace.
