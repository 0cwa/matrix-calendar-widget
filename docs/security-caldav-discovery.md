# CalDAV discovery credential boundary

The gateway delegates short-lived Matrix OpenID proofs to Radicale using
credential-bearing CalDAV requests. CalDAV discovery therefore treats the
configured `RADICALE_URL` and every href in the peer's response as untrusted
input at the request boundary.

`RADICALE_URL` must be a canonical HTTP(S) service directory with no userinfo,
query, or fragment. Its normalized origin and directory path define the only
scope for credential-bearing discovery requests. Principal, calendar-home,
and collection hrefs must resolve to that same origin and remain beneath the
configured path. The client rejects hrefs with credentials, a query or
fragment, unsafe encoded path separators or traversal, or an out-of-scope URL
before it asks the credential provider for headers or sends a follow-up
request. Safe relative hrefs are resolved against the service, principal, or
calendar-home URL as appropriate, retaining a reverse-proxy base path.

Every discovery `PROPFIND` uses manual redirect handling. Any 3xx response is
rejected with a fixed generic error; the client does not read the response
body or follow the `Location`, including for same-origin redirects. Configure
the service URL to point directly at the canonical CalDAV endpoint rather
than relying on redirects.

This boundary covers `CalDavDiscoveryClient` discovery `PROPFIND` requests.
It does not claim that event-resource fetches or other CalDAV adapters have
the same URL or redirect policy, and it does not change the gateway's existing
caller authentication or authorization rules.
