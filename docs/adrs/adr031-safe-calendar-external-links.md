# ADR031: Safely display external links from calendar events

- Status: Accepted
- Date: 2026-10-03

## Context

VEVENT resources can carry an event `URL`, URI `ATTACH` properties, and
`CONFERENCE` properties. Those values are untrusted calendar input. They may
contain non-web schemes, relative references, embedded credentials, binary
attachment data, misleading labels, or parameters the widget does not
understand. The current codec preserves properties that the domain does not
edit, but the widget has no bounded safe-link projection for displaying these
values.

## Decision

1. The calendar domain may expose a read-only `externalLinks` projection for
   the VEVENT `URL`, URI-valued `ATTACH`, and `CONFERENCE` properties. Each
   projected link has a kind (`event`, `attachment`, or `conference`), a
   canonical absolute HTTP(S) `href`, and an optional plain-text label. This
   projection is excluded from event creation inputs and patches; it is not a
   write model for source properties.
2. Accept a URI only when it starts with an absolute `http://` or `https://`
   scheme, contains no control characters or backslashes, parses with `new URL(value)` without a base, contains no user information, and has a
   canonical serialized length no greater than 4096 characters. Reject
   protocol-relative, relative, credential-bearing, and non-HTTP(S) values.
   The reader projects at most 20 links per event.
3. Project `ATTACH` only when it is URI-valued (the RFC default URI type is
   allowed); `VALUE=BINARY` data is never projected. `CONFERENCE` labels are
   limited to 120 Unicode code points after control and bidirectional-format
   characters are removed. Render the label as ordinary React text, never as
   markup. All displayed links are canonicalized again before the widget
   creates an anchor so that repository mocks or another in-memory producer
   cannot bypass the URI policy.
4. Show links only as explicit user-click anchors. Open them in a new browsing
   context with `rel="noopener noreferrer"`; do not fetch, preview, download,
   embed, or automatically navigate to their destination. `matrix.to` URIs
   follow the same explicit-link behavior; do not infer room membership,
   conference participation, room aliases, or scheduling metadata from them.
5. Unsafe or over-limit values are omitted from the display projection but
   remain in the original iCalendar component. An ordinary event edit must
   preserve URL, ATTACH, CONFERENCE, ORGANIZER, ATTENDEE, unknown parameters,
   and binary attachment source data without rewriting or normalizing them.
   The codec does not add, remove, or edit these properties through the
   external-link projection.

## Consequences

Users can open supported event and conference links deliberately, while
malformed or unsafe schemes remain non-clickable. The widget does not retrieve
remote content or treat a link as proof of Matrix room access. The source
VEVENT remains the authority for uninterpreted properties, and a normal edit
continues to preserve those properties and parameters.
