# ADR010: Restrict CalDAV URL diagnostics to calendar managers

- Status: Accepted
- Date: 2026-09-26

## Context

Administrators need copyable CalDAV collection URLs when diagnosing calendar
configuration. Ordinary room members can list calendars, so the general
calendar-list permission is too broad for a diagnostics surface. Radicale
discovery also returns principal and calendar-home URLs that are not useful
collection diagnostics and should not be exposed by this feature.

## Decision

- Add a dedicated `GET /v1/calendar/calendars/diagnostics` gateway endpoint.
- Require the normal validated Matrix identity and room membership, then check
  the existing calendar manager power policy before starting CalDAV discovery.
  The factory exposes a room-level manager check that uses the same joined
  membership and power-level predicate as `manage-calendar`, without inventing
  a collection ID for this cross-calendar operation.
- Return only the display name and URL of discovered calendar collections
  within the configured Radicale service. Exclude service, principal, and
  calendar-home roots, and collection URLs that contain user information,
  query parameters, or fragments.
- Keep diagnostics in an Advanced CalDAV diagnostics dialog. Render URLs as
  text with an explicit copy control; do not navigate to them automatically.
- Do not return CalDAV credentials, Matrix OpenID assertions, authorization
  headers, or request dumps.

## Consequences

Calendar diagnostics have their own manager-only authorization check rather
than inheriting the broader room-member permission for listing calendars. The
widget reports clipboard success only after the browser confirms the write and
announces copy failures accessibly.
