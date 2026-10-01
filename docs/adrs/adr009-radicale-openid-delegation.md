# ADR009: Delegate Matrix OpenID to Radicale without Matrix passwords

- Status: Accepted
- Date: 2026-09-23

> **Supersession notice (ADR024, 2026-10-01):** ADR024 supersedes this ADR's
> external-only implementation requirement and its conventional Matrix-
> password CalDAV compatibility path. The owned Radicale backend accepts only
> ADR009's explicitly tagged short-lived OpenID credential and rejects
> untagged credentials; the pre-alpha does not support conventional CalDAV
> login with Matrix passwords. No `radicale-auth-matrix` source or package is
> included or invoked by the project-owned image. The tagged credential
> format, identity checks, and security requirements below remain in force as
> narrowed by ADR024. Any independent Radicale-native credential mode needs a
> separate future ADR.

## Context

ADR006 requires the widget to authenticate to the calendar gateway with Matrix
OpenID and forbids the gateway from requesting or storing a user's Matrix
password.

The currently pinned `etkecc/radicale-auth-matrix` plugin does not support
Matrix OpenID. Its authentication backend treats the CalDAV Basic Auth password
as a Matrix password, calls `/_matrix/client/v3/login` with
`m.login.password`, receives a temporary Matrix access token, and logs that
token out.

That flow is appropriate for conventional CalDAV clients that already possess a
Matrix password, but it cannot be used by the widget gateway without violating
ADR006.

## Decision

Extend `radicale-auth-matrix` with a second, explicitly tagged credential mode
while preserving its existing password behavior.

### Conventional CalDAV clients

No behavior changes:

- Basic Auth username is the Matrix localpart;
- Basic Auth password is the user's Matrix password;
- the plugin continues to authenticate using `m.login.password`.

### Calendar gateway

The gateway still sends CalDAV Basic Auth because that is the Radicale auth
plugin boundary, but the password field is a delegated credential rather than a
Matrix password.

The delegated password format is:

```text
matrix-openid:<base64url(JSON)>
```

where the decoded JSON object is:

```json
{
  "access_token": "<short-lived Matrix OpenID access token>",
  "matrix_server_name": "<issuing Matrix server name>"
}
```

The Basic Auth username remains the Matrix localpart.

The gateway constructs this credential only from the OpenID token that was
already validated for the current HTTP request. It must never persist, log, or
cache the encoded credential.

### Radicale plugin validation

When the password does not start with `matrix-openid:`, the plugin follows its
existing password-login path unchanged.

When the prefix is present, the plugin must:

1. base64url-decode and strictly parse the JSON payload;
2. require non-empty string `access_token` and `matrix_server_name`;
3. call the configured homeserver's
   `/_matrix/federation/v1/openid/userinfo?access_token=...` endpoint;
4. require a successful response containing a Matrix ID in `sub`;
5. parse `sub` and require its localpart to equal the Radicale Basic Auth
   username;
6. require the server name in `sub` to equal `matrix_server_name`;
7. return the username only when all checks succeed.

OpenID credentials must **not** use the plugin's password-authentication cache.
The homeserver remains authoritative for each delegated credential's validity.

## Security properties

- The widget never receives or asks for a Matrix password.
- The gateway never receives or stores a Matrix password.
- A stolen delegated credential is bounded by the Matrix OpenID token lifetime.
- The username cannot be swapped independently of the validated Matrix identity.
- The issuing Matrix server cannot be swapped independently of the validated
  Matrix identity.
- Ordinary password-based CalDAV clients remain compatible.
- Request/authorization logging must redact the delegated credential.

## Deployment (historical; superseded by ADR024)

This section records the deployment proposal made when ADR009 was accepted.
ADR024 supersedes it: the project now implements the Radicale auth module in
this repository and builds an owned image; the current dev and contract stacks
use that image. The etke-host override and data-volume compatibility remain
unverified.

## Consequences

The gateway can use the same Matrix OpenID proof already validated by
`MatrixAuthMiddleware` for CalDAV delegation without introducing Matrix
password handling.

This was the earlier proposal. ADR024 supersedes it with a clean-room module in
this repository; no third-party auth package is copied, installed, or invoked.
