# ADR011: Expose opaque unsupported-recurrence diagnostics

- Status: Accepted
- Date: 2026-09-26

## Context

The CalDAV codec retains the original VCALENDAR so edits can preserve
properties that the domain model does not understand. A
`RECURRENCE-ID;RANGE=THISANDFUTURE` component that changes fields beyond the
supported timing subset cannot be expanded safely. The gateway previously
returned only modeled event fields, so the widget could not distinguish that
resource from a complete recurrence set and could display misleading
occurrences.

## Decision

- Add the optional response-only `unsupportedRecurrence` string to the nested
  calendar event DTO. The codec sets it to `ranged-override` when a resource
  contains a ranged override whose shape or payload is unsupported. Timing-only
  ranges accepted by ADR017 are modeled and expanded instead.
- Keep the field out of event creation and patch inputs. It is diagnostic
  metadata, not calendar data.
- Preserve the source VCALENDAR and its unknown properties unchanged. Do not
  expose the raw component or interpret the RANGE parameter through this field.
- When the marker is present, clients must not expand the partial recurrence
  model and must show a visible unsupported-recurrence warning.
- Treat the field as optional so older clients can ignore it and newer clients
  can safely warn for future marker values.

## Consequences

The widget can avoid rendering an incomplete series while explaining why it is
omitted. CalDAV remains the source of truth. ADR017 defines the narrow supported
timing-only following-scope behavior; the diagnostic does not enable best-effort
editing of unsupported ranged exceptions. Clients that ignore the optional
field retain their existing behavior.
