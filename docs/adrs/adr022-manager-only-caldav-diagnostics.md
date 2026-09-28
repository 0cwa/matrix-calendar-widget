# ADR022: Expose manager-only CalDAV collection diagnostics

- Status: Accepted
- Date: 2026-09-28

## Context

Administrators sometimes need a collection URL to diagnose calendar access for
a Matrix room. Radicale discovery also returns principal and home-set URLs, and
CalDAV request failures can contain service details or authentication context.
The diagnostics feature must therefore expose only the minimum useful value
and preserve the gateway's existing Matrix identity and room authorization
boundary from ADR006 and ADR010.

## Decision

1. Serve diagnostics only through the authenticated calendar gateway. Require
   a validated Matrix OpenID identity, current joined-room membership, and the
   configured calendar-manager power before starting Radicale discovery.
2. Return only each safe collection's display name and collection URL. Exclude
   the Radicale service root, principal URL, calendar-home URL, URLs with
   userinfo, query strings, or fragments, URLs from another origin, and URLs
   outside the configured Radicale base path.
3. Do not return credentials, access tokens, authorization headers, raw
   discovery responses, or raw CalDAV errors. Report a generic unavailable
   result for service/configuration failures.
4. Render collection URLs as selectable plain text in the widget. Do not make
   them links or navigate to them. Provide an explicit copy action; show copy
   success only after the browser clipboard operation resolves successfully.

This decision does not change ADR010's personal and room-owned principal
model, establish any new CalDAV authentication capability, or allow a Matrix
sender value to substitute for validated OpenID identity.

## Consequences

- The gateway performs the manager check before contacting Radicale, and the
  widget has no authorization role beyond exposing a diagnostics action.
- Collection URLs are disclosed only to an authenticated joined room member
  with manager power and remain subject to the configured Radicale base URL.
- Operators can copy a useful collection path without exposing principal or
  service roots, credentials, or navigable destinations in the widget.
- Clipboard denial is visible as a failure; the widget does not claim success
  before the browser confirms the copy operation.
