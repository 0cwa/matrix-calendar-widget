# ADR046: Scoped private CalDAV clients

- Status: Accepted
- Date: 2026-10-21

## Context

Users need to connect standards-based desktop and mobile calendar clients to a personal or room calendar and edit events without putting Matrix credentials in those clients. Private access differs from a public ICS feed: it needs principal/home discovery, VEVENT read/write, conditional updates, and current Matrix authorization. A native Radicale RW token is a bearer capability that cannot enforce later room-policy changes. A Radicale map alias supports the required discovery and DAV operations, but its sharing API can create cross-app invitations if exposed.

The accepted public-feed design (ADR045 on its active branch) keeps Radicale `owner_only` rights and disables map sharing. ADR046 must narrowly compose private-client policy with the existing owner-only behavior and retain public feeds as read-only. This proposal does not supersede unrelated ADR decisions.

## Decision

Implement one scoped Radicale map alias per private client credential, behind a strict DAV route on the existing API HTTPS origin. Use the root-level URL `https://<api-origin>/<appID>/calendar/`, where `appID` is `mcwpc~` plus 192 cryptographically random bits. Preserve native hrefs by forwarding the accepted path unchanged. Keep existing Nest URI-versioned REST routes under `/v1/` unchanged; no new hostname is required. Do not expose Radicale directly, raw token URLs, or the native map-sharing API.

Reserve the entire `mcwpc~` namespace. Radicale Auth accepts a reserved ID only as a private-client credential and rejects every Matrix/OpenID identity whose localpart begins with that namespace. Unknown, malformed, expired, revoked, or wrong-epoch reserved IDs fail closed and never fall through to `owner_only`. Rights applies the same dispatch rule. On provisioning, require a unique never-reused ID and probe `/<appID>/` using the pending app credential while Rights grants only `R` on that exact principal path. Radicale 3.8 returns `404` for an absent home under `R`; a `207` means the reserved home already exists and enrollment must refuse it. Only after the absent-home check may a deadline-checked pending-to-bootstrap compare-and-set grant the principal home `RWdD` (Radicale's collection-delete denial markers) and the exact alias `r`. Radicale creates the synthetic home when an authenticated request has `W`; its runtime contract confirms this mask supports standard discovery while denying home deletion. Create only the exact `/<appID>/calendar/` map as the canonical collection owner with `User=appID`, then read it back as that owner and validate owner, target, mapping, permissions, and visibility. Use the server-held secret to accept and unhide the exact map as the app ID. A native Radicale client can read the accepted map during the short pending interval before database activation; the secret remains server-held and the external DAV gateway denies every pending request. Activate only from the bootstrap state after accepted-map verification, then reveal the secret once.

Store private-client metadata in an optional app-owned PostgreSQL schema with a separate database setting. Store app ID, actor and exact calendar target, one-way verifier for a random 32-byte secret, state, timestamps, expiry, and private credential epoch. Store no Matrix password, Matrix access token, OpenID proof, or recoverable client secret. Reveal the secret once at enrollment; clients place it in their OS credential store. Browser state may retain non-secret metadata only. Lost credentials are revoked and replaced with a new app ID.

Every Basic authentication checks the active credential, expiry, verifier, and epoch with Radicale login caching disabled. Every DAV request is path-normalized and checked by the gateway and Radicale Rights against current calendar binding, room membership, and effective power. A room credential is bound to the manager who issued it; while that user remains joined and has calendar-manage power, the client may read and write. Loss of manage power makes the next request read-only. If a request observes that the issuer has left or been banned, that request denies access even if the tombstone write fails. A successfully committed revoked tombstone is terminal and a later rejoin does not restore it. If the store cannot commit the tombstone, the failed request remains denied, but this request-driven design cannot record the leave history; a later request may be allowed if membership has returned and no tombstone was committed. Detection is request-driven: there is no background membership-history observer, so a leave or ban followed by rejoin between policy checks may not be observed and is not guaranteed to cause terminal revocation. Unknown policy state, timeout, or credential-store failure denies the request. Authorization linearizes at the final fresh Rights check; an already-authorized in-flight write may finish after a later policy change.

Revocation marks the credential revoked before any cleanup attempt. Keep a permanent inactive tombstone and never reuse its app ID. Physical map removal is best-effort garbage collection performed as the canonical map owner, without the client secret. If owner proof is unavailable, the inactive alias may remain: no valid app credential can authenticate it, and the client cannot reach Radicale’s sharing API. For restore safety, keep the active private credential epoch outside database backups; rotate it before restored ingress opens. This epoch is separate from the public-feed key and does not alter ADR045 key persistence.

## DAV route contract

Allow only `OPTIONS`, `PROPFIND`, `REPORT`, `GET`, `HEAD`, `PUT`, and `DELETE`. Limit principal and alias `PROPFIND` to `Depth: 0` or `1`; limit `REPORT`, `GET`, and `HEAD` to that alias and its resources; limit `PUT` and `DELETE` to resource descendants. Never allow collection deletion or replacement. Deny collection creation, move/copy, property writes, locks, all `/.sharing/**` and `/.token/**` paths, admin/web endpoints, canonical owner paths, and sibling app IDs.

Parse the raw target before framework decoding. Reject queries, malformed or double-encoded escapes, encoded slash/backslash, literal backslash, NUL, dot segments, repeated separators, and paths outside the exact principal/alias scope. Forward accepted paths and DAV XML unchanged, preserving ETag and conditional headers. Bound request/response sizes and timeouts; redact Basic credentials and private paths from logs. Register this root namespace route after `CalendarGatewayRateLimitMiddleware` and before `MatrixAuthMiddleware` in `matrix-calendar-server/src/http/CalendarGatewayHttpApplication.ts`; keep Nest REST routes under `/v1/` unchanged.

Radicale-to-gateway Auth/Rights callbacks use a fixed internal HTTPS endpoint on the existing trusted network. Require certificate-chain and hostname verification, no redirect or ambient proxy, a five-second timeout, bounded raw request/response bodies, and fail-closed behavior. Authenticate each callback using HMAC-SHA256 under a dedicated 32-byte internal key, distinct from the private credential epoch and public-feed signing key. The signed versioned envelope covers action, exact fixed path, timestamp, fresh 128-bit nonce, and SHA-256 of the exact raw request body; authenticate the bounded response too. Allow at most 30 seconds of clock skew and consume each nonce once for 60 seconds in a 10,000-entry process-local replay cache; cache overflow denies the callback. This nonce design requires a single gateway replica. Keep the feature disabled on multi-replica deployments until nonce consumption is shared atomically. Do not add a general callback framework.

## Public-feed compatibility

The Radicale configuration retains public feed tokens as read-only while enabling map sharing required by private clients. Composite Rights delegates every non-reserved identity to the existing `owner_only` implementation unchanged and evaluates private IDs separately. The external DAV route rejects every native sharing/token endpoint. Preserve the public signed-URL gateway and raw native token rejection. Before enabling the combined configuration, rerun the complete public-feed contract against Radicale with map and token sharing enabled. This ADR narrowly supersedes ADR024's OpenID-only Radicale-auth assumption and ADR045's map-disabled settings (`collection_by_map`, `permit_create_map`) plus its literal `owner_only` Rights plugin selection. It does not change ADR045's public token permissions, URL lifetime, gateway, signing key, or publication policy.

## Provisioning lifecycle

1. Authorize the actor against the current personal owner or room membership/power; enforce issuance limits and expiry policy.
2. Insert a `pending` record and mint the one-time secret in memory.
3. With pending Rights limited to principal-home `R`, require `PROPFIND /<appID>/` to return `404`. Refuse and tombstone an existing home. Move the row to `bootstrap` with a compare-and-set that checks state, expiry, and pending lifetime; only this state grants `RWdD` on the principal home.
4. Create and verify the exact map as the canonical owner, then accept/unhide the exact map with the pending app credential. Native Radicale access can read the accepted alias while the row is still `bootstrap`; the external gateway checks active state and denies this interval. On failure, expiry, revocation, or ambiguous outcome, do not activate or release the secret; mark the row revoked and attempt exact map cleanup.
5. Activate only from the unexpired `bootstrap` state after accepted-map read-back. Then return the secret once. A lost response may leave an active but unknown credential, bounded by expiry, issuance limits, and user revocation controls.
6. On user revocation or a request that confirms the issuer has left or been banned, persist the revoked state before cleanup. The request that observes leave denies even when persistence fails. Only a committed tombstone guarantees that a later rejoin cannot restore access; after a failed write, a later request may allow access if current membership has returned. Membership transitions are observed only during requests; there is no background observer guaranteeing that an unobserved leave/rejoin interval creates a tombstone. Attempt owner-authenticated map deletion asynchronously and retain the tombstone whether or not cleanup succeeds.
7. On database restore, rotate the out-of-backup private epoch before opening ingress; require credential reissue.

## Consequences

Private credentials do not require storing Matrix tokens or recoverable app secrets. Standards clients can perform principal/home discovery and object CRUD while current room policy governs each external gateway request. The server owns a small credential/map lifecycle service and a narrow DAV route. A pending accepted map is readable through native Radicale if its server-held secret is used; no secret is released until activation, and the external gateway denies pending credentials. A committed tombstone after an observed leave or ban is terminal; if the store cannot commit it, only the current request is guaranteed denied. An unobserved leave/rejoin between requests cannot be detected by this request-scoped design. Old map files may remain after revocation, and the deployed route must preserve a reserved root namespace. Multi-replica deployments need shared atomic nonce consumption if callback replay protection depends on a nonce cache; until then the feature is disabled on multi-replica gateway deployments.

## Validation contract

Before enabling private clients, the implementation must prove the reserved
namespace behavior and map lifecycle against the pinned Radicale runtime;
authenticate every request through the strict root DAV route; run the public
feed contract with both map and token sharing enabled; and exercise a
standards-based CalDAV client through principal/home discovery, scoped
collection listing, read/create/update/delete, stale ETag conflict, unknown
VEVENT-property preservation, credential revocation, and current room-power
loss. The tracked [PostgreSQL store integration contract](../../matrix-calendar-server/src/service/PostgresPrivateCalendarClientStore.integration.test.ts)
proves pending and active credentials, expiration, verifier clearing, and
permanent tombstones across adapter restart. After a custom-format dump/restore,
run it with `MATRIX_CALENDAR_PRIVATE_CLIENT_STORE_VERIFY_RESTORED=true`; the
read-only verification checks restored rows and proves that rotating the
external private epoch rejects a restored credential. None of these contracts
authorize a production rollout; the feature remains default off until the
complete set passes.
