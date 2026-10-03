# ADR026: Bound pre-authentication calendar gateway requests

- Status: Accepted
- Date: 2026-10-03

## Context

The calendar gateway's global Matrix authentication middleware validates
widget OpenID assertions by calling the configured homeserver. Calendar
controller guards and CalDAV work follow that call. Without an earlier bound,
an unauthenticated caller can repeatedly trigger homeserver verification and
gateway work. The service currently runs as one deployable process, and the
repository has no shared rate-limit store.

## Decision

1. Register a process-local source limiter for `/v1/calendar` and its
   descendants before `MatrixAuthMiddleware`. Other HTTP routes do not consume
   its quota. The limiter counts requests before OpenID verification; it does
   not replace actor authentication, room membership, or power checks.
2. Key requests only by the TCP peer address on `request.socket.remoteAddress`.
   Ignore `X-Forwarded-For` and other caller-supplied forwarding headers. A
   reverse proxy therefore presents one shared source to this limiter unless
   an upstream layer applies its own per-client quota.
3. Use a per-source fixed window of 120 requests per 60 seconds by default.
   Operators may set `MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS`,
   `MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_WINDOW_MS`, and
   `MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_MAX_KEYS`. Joi validation requires
   positive finite integers and bounds the values: 1–100,000 requests,
   1–86,400,000 milliseconds, and 1–10,000 source keys. The default source-key
   cap is 10,000.
4. Keep counters in a bounded in-memory map. Opportunistic expiry cleanup scans
   at most 10,000 entries and runs no more often than once per the smaller of
   the configured window or 10 seconds. Once the map is
   full, requests from unseen sources fail closed with a generic 429 response
   and a conservative `Retry-After`; existing source entries continue to use
   their own window. An over-limit source receives the remaining window rounded
   up to whole seconds.
5. Return only a generic rate-limit response. The limiter emits no logs and
   does not put source keys or request details in its response. Existing
   credential and content redaction at the HTTP logging boundary remains in
   force.

## Consequences and limits

The bound runs before homeserver OpenID verification and prevents the per-source
counter map from growing without limit. The map and counters are process-local:
they reset on restart, and each replica enforces an independent quota. A proxy
that hides client addresses causes its callers to share the same quota; tune
the request limit or apply a trusted upstream per-client limit in that
deployment. This is a narrow request-count control, not a distributed DDoS
defense, body-size limit, or completion of the other M8 security and deployment
gates. Repository tests and configuration do not establish live deployment
behavior.
