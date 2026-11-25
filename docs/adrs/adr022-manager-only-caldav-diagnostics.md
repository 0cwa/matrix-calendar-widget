# ADR022: Expose manager-only CalDAV collection diagnostics

[Decision index](./README.md) · [Documentation](../README.md)

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
4. Do not display or copy raw collection URLs in the normal widget UI. The
   manager-authorized gateway response may be used by explicit support tooling;
   such tooling must not imply that a deployment-internal address is usable by
   calendar clients.

This decision does not change ADR010's personal and room-owned principal
model, establish any new CalDAV authentication capability, or allow a Matrix
sender value to substitute for validated OpenID identity.

## Consequences

- The gateway performs the manager check before contacting Radicale. The normal
  widget UI does not request or display its raw collection URL response.
- Explicit support tooling remains subject to the existing authenticated,
  joined-room manager check and configured Radicale base URL.
- The UI does not suggest that a discovered collection URL is a public or
  client-usable sharing address.

## Update — 2026-10-21

The initial widget copy affordance was removed after recognizing that the
configured CalDAV address can be deployment-internal and unusable to calendar
users. This changes only the widget presentation; the manager-authorized
gateway diagnostics endpoint and its existing authorization and response
constraints remain available to explicit support tooling.
