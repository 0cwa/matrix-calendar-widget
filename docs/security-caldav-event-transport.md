# CalDAV event transport boundary

Credential-bearing CalDAV event `REPORT`, `GET`, `PUT`, and `DELETE` requests
use manual redirect handling. The gateway rejects every 3xx response,
including a redirect to the same origin, a different resource on that origin,
or the exact same resource. It does not inspect `Location`, read the redirect
body, or issue a second request. Configure `RADICALE_URL` and collection
addresses to point directly to the canonical endpoint.

Successful event `REPORT` and `GET` response bodies are read as streams and
stopped once the configured byte ceiling is exceeded. The default is 16 MiB;
`MATRIX_CALENDAR_CALDAV_MAX_EVENT_RESPONSE_BYTES` accepts an integer from 1
through 64 MiB. The byte count is enforced on received chunks even when
`Content-Length` is absent or inaccurate. Oversize, unreadable, and redirected
responses return a fixed generic gateway error; the response body and redirect
target are not included in that error.

Inbound JSON and urlencoded HTTP request bodies have an explicit 100kb limit,
matching the existing Express body-parser default. The parser is installed
before Matrix authentication middleware so an oversized body is rejected
before identity validation or CalDAV work.

This limit is per response and per gateway process. It does not limit response
time, aggregate data over multiple requests, or discovery response bodies.
