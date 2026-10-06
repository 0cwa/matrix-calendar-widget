# ADR 036: Bounded authoring of one conference link

- Status: Accepted
- Date: 2026-10-06

## Context

ADR 031 added a sanitized, read-only `externalLinks` projection. It does not
define a write model for the source `CONFERENCE` property. Users need a way to
add or update one ordinary web conference link without turning arbitrary
calendar-provided conference or attachment data into editable input.

RFC 7986 §5.11 defines `CONFERENCE` as a URI-valued property with no default
value type and permits multiple properties and parameters such as `FEATURE`
and `LABEL`. §6.4 defines `LABEL` as human-readable text. The existing
`externalLinks` view remains a safe display projection; the stricter authoring
rules below are a separate contract.

## Decision

1. Event creation may include one `conference` value with a URL and optional
   label. A master-event patch uses an explicit `set` or `remove` operation.
   Setting the value replaces its URI and LABEL pair; omitting the label clears
   LABEL. Clearing the URL in the editor removes the whole property.
2. Authoring accepts only an absolute, safe HTTP(S) URL under ADR 031's URI
   limits, and an optional plain-text label of at most 120 Unicode code points.
   The server validates the runtime shape as well as the widget form. Read-only
   projection fields cannot be submitted as write data.
3. A source property is editable only when the master VEVENT has exactly one
   raw `CONFERENCE` line with exactly one explicit `VALUE=URI` parameter, no
   more than one `LABEL` parameter, and a safe URI and label. A missing VALUE,
   another value type, repeated VALUE or LABEL parameters, repeated
   CONFERENCE properties, or an unsafe value marks conference data read-only.
   Unsupported source data remains available to `externalLinks` only when
   that existing sanitized reader can safely display it; it does not become a
   write model.
   Master writes are also read-only when a same-UID detached VEVENT contains a
   `CONFERENCE` property or when the resource has duplicate same-UID masters;
   the current occurrence projection reads conference links from the master
   only and cannot safely reconcile those cases.
4. Adding a link creates one `CONFERENCE;VALUE=URI` property. Updating an
   eligible property changes only its URI and LABEL; existing `FEATURE` and
   other parameters and sibling event properties are retained. Removing it
   removes only that eligible property. Ordinary edits, occurrence timing
   edits, and following timing edits preserve the original raw CONFERENCE
   lines on every source VEVENT. New detached timing clones retain the source
   master's raw conference lines. Conference writes are available only for a
   master whose same-UID detached components do not carry conference data and
   whose master identity is unambiguous.
5. Existing `externalLinks` remains excluded from inputs and patches. The
   widget renders links only as explicit user-click anchors under ADR 031; it
   does not fetch, preview, upload, or probe a conference destination. Normal
   gateway authorization and conditional ETag updates continue to protect
   writes; a verified same-value operation does not create a revision.

## Consequences

Users can add, label, change, or remove one safe web conference link through
the regular event editor. RFC-valid source forms outside this bounded subset
remain read-only and are preserved for clients that understand them. This
decision does not expand authoring to multiple conferences, other URI schemes,
attachments, detached occurrences, or following recurrence writes.

## References

- [RFC 7986 §5.11, CONFERENCE](https://www.rfc-editor.org/rfc/rfc7986.html#section-5.11)
- [RFC 7986 §6.4, LABEL](https://www.rfc-editor.org/rfc/rfc7986.html#section-6.4)
- [RFC 7986 §7, Security Considerations](https://www.rfc-editor.org/rfc/rfc7986.html#section-7)
- [ADR 031: Safely display external links from calendar events](adr031-safe-calendar-external-links.md)
