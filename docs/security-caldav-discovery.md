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

Every discovery `PROPFIND` and collection `MKCALENDAR`, `PROPPATCH`, or `DELETE`
uses manual redirect handling. Any 3xx response is
rejected with a fixed generic error; the client does not read the response
body or follow the `Location`, including for same-origin redirects. Configure
the service URL to point directly at the canonical CalDAV endpoint rather
than relying on redirects.

Collection mutation URLs receive the same origin/base-path confinement before
credential headers are requested. Creation names are bounded to 255 ASCII
characters and reject `.` and `..` before home discovery.

Discovery and property-update XML responses are streamed under a fixed 16 MiB
byte limit before parsing. Actual bytes count even when Content-Length is
absent or false; an excessive advertised length is rejected without reading.
Document type declarations are rejected before entity processing. Reader and
limit errors have fixed messages, and unused/error response bodies are cancelled
when the transport supports it. These bounds do not provide a network deadline
or a total process-memory guarantee.

This boundary covers `CalDavDiscoveryClient` discovery and collection requests.
Event-resource transport has its own documented bounds. Caller authentication
and authorization remain enforced by the gateway and are unchanged here.
