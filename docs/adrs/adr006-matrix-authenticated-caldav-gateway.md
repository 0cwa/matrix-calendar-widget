# ADR006: Use a Matrix-authenticated gateway between widgets and CalDAV

- Status: Accepted
- Date: 2026-09-22

> **Implementation note (ADR024, 2026-10-01):** The following plugin sentence
> records the development deployment's earlier behavior. ADR024 selects a
> project-owned Radicale backend that accepts only explicitly tagged,
> short-lived OpenID credentials and rejects untagged credentials; ordinary
> Matrix-password CalDAV login is unsupported and deferred in this pre-alpha.
> The selected backend and image are not implemented or deployed yet.

## Context

The development Radicale setup at the time of this ADR used a Matrix auth
plugin to authenticate conventional CalDAV clients with Matrix credentials. A
Matrix widget does not and should not receive the user's Matrix password.
Direct browser-to-Radicale access would also complicate CORS, credential
storage, authorization, reminders, and command fallback.

## Decision

The widget talks to a calendar gateway. The gateway and Matrix bot are initially one deployable service.

Authentication flow:

1. widget obtains a Matrix-provided short-lived OpenID/identity assertion,
2. gateway validates it against the homeserver,
3. gateway resolves room membership and calendar authorization,
4. gateway performs allowed CalDAV operations server-side.

The widget must never request a Matrix password or persist long-lived Matrix/CalDAV credentials.

The exact Radicale delegation mechanism is an implementation task and must preserve this boundary.

## Consequences

Authorization can be enforced consistently for widget API calls, reminders, and command fallback. The server becomes a security-sensitive component and needs rate limiting, secret hygiene, and contract tests.
