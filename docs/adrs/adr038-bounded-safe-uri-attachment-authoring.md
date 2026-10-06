# ADR 038: Bounded authoring of safe URI attachments

- Status: Accepted
- Date: 2026-10-06

## Context

ADR 031 projects safe calendar URLs for explicit user-click navigation but
keeps that projection out of event inputs. RFC 5545 ATTACH supports both URI
and binary attachment data, and permits multiple ATTACH properties. The current
event editor cannot safely infer which raw property a user intended to replace
from a plain list of links.

## Decision

1. Event creation may include one safe HTTP(S) URI attachment. A master-event
   patch accepts one explicit add, set, or remove operation. Set and remove
   identify their source by its canonical safe URL. A patch submits at most
   one attachment operation; other ordinary event fields may be saved in the
   same request.
2. ATTACH with the default URI value type or exactly one VALUE=URI parameter
   may be projected for authoring when its URL passes ADR 031 validation.
   Binary values, unsafe URLs, repeated or non-URI VALUE parameters, and other
   unsupported source forms remain opaque. The read-only externalLinks
   projection remains the navigation surface; the separate attachments
   projection is capped at 16 authorable URI links.
3. A set or remove may target only one unique canonical source URL. Adding a
   URL already present is an exact no-op only when that canonical URL occurs
   once. Duplicate canonical source URLs, an over-limit projection, multiple
   same-UID masters, or a same-UID detached VEVENT containing ATTACH disable
   attachment authoring for the event. Detached components without ATTACH may
   inherit the master property. Occurrence and following writes cannot author
   ATTACH.
4. An attachment operation changes only its target URI line or appends/removes
   one URI line. It retains original parameters, folding, order, and all
   unrelated raw ATTACH lines, including binary, unsafe, or otherwise opaque
   siblings. Ordinary, occurrence, and following timing edits preserve the
   source ATTACH lines on every VEVENT; new detached clones retain the master's
   lines.
5. The widget offers one add, replace, or remove operation per Save. Existing
   external links remain explicit click targets only. The editor does not
   upload, download, preview, fetch, or probe attachment destinations.
   Gateway authorization and conditional ETag updates continue to protect
   writes. A verified same-value operation preserves the original resource
   bytes and revision.

## Consequences

Managers can add one safe URI attachment or choose one existing URI link to
replace or remove per save. Binary and unsupported data remain available to
other CalDAV clients and are not rewritten by this feature. This decision does
not add file upload, attachment downloads, occurrence-specific attachments, or
general-purpose multi-property editing.

## References

- [RFC 5545 §3.8.1.1, ATTACH](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.1.1)
- [RFC 5545 §3.2.8, VALUE parameter](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.2.8)
- [ADR 031: Safely display external links from calendar events](adr031-safe-calendar-external-links.md)
- [ADR 036: Bounded conference link authoring](adr036-bounded-conference-link-authoring.md)
