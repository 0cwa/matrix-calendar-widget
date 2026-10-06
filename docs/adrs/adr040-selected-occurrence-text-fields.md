# ADR 040: Bounded selected-occurrence text edits

- Status: Accepted
- Date: 2026-10-06

## Context

ADR029 supports a timing edit for one selected recurrence instance while
preserving its original typed RECURRENCE-ID. The selected instance is projected
from the master and any detached VEVENT, but title, description, and location
currently remain series-only. Editing those fields must keep the master and
unrelated components unchanged, preserve explicit inheritance, and retain
source properties that the bounded editor cannot safely interpret.

## Decision

1. Keep ADR029's public `recurrence.occurrence` `set-timing` operation
   unchanged. Add a `set-fields` operation with the same required typed
   `recurrenceId` and validated `viewerTimezone`, one or more sparse
   `title`, `description`, or `location` operations, and optional timing.
   A text-only write is valid. Each text operation is either
   `{ action: 'set', value }` or `{ action: 'inherit' }`. A set title must
   contain non-whitespace text, consistent with the existing event form;
   imported blank titles remain readable and can be saved unchanged or while
   another supported field changes. Empty description and location values are
   distinct explicit overrides.
2. An absent SUMMARY, DESCRIPTION, or LOCATION on a detached VEVENT inherits
   the master's corresponding value. An omitted operation leaves an existing
   override field untouched. An explicit `inherit` removes that property.
   Source presence determines whether the UI is in custom or series mode; a
   custom value that happens to equal the master remains an explicit override.
   For a new `set-fields` component, remove the cloned controlled text
   properties before applying explicit sets, so omitted fields inherit.
   If timing is omitted for a new text override, use the validated projected
   timing of the original occurrence. Existing override timing stays as-is
   when omitted. A legacy timing-only `set-timing` write continues to clone
   the master's text and supported metadata as specified by ADR029.
3. The read projection returns a single scalar TEXT value for a detached
   controlled property when it can be safely decoded, including a parameterized
   value, and marks that field read-only when it has parameters. Missing fields
   inherit the master. Repeated, multivalued, or non-TEXT properties are marked
   unsupported and are not authored. The editor disables only the affected
   field. Writes to supported fields preserve the untouched raw text lines,
   parameters, unknown properties, master, sibling VEVENTs, and unrelated
   resource components. The codec fails closed when the requested target field
   itself has an unsupported source shape.
4. The write continues to identify a generated, non-excluded occurrence by
   its original typed RECURRENCE-ID, even when an existing override has moved.
   Existing ADR029 alarm, recurrence, timezone, identity, cancellation, and
   revision guards remain in force. The runtime patch shape is checked by the
   gateway before CalDAV reads and is rechecked in the repository and codec.
   Updates use the existing single-resource conditional ETag path. A
   semantically unchanged text operation returns the original bytes; inheriting
   from a missing field does not create an empty detached component.
5. The widget exposes the three text controls only after the user selects
   “This occurrence only” and provides an explicit “Use series” control for
   each field. Its mode follows source property presence, not string equality.
   This phase adds no title, description, or location write to
   `recurrence.following`; that operation remains timing-only under ADR034.
   Whole-series text edits retain their existing behavior.

## Consequences

Users can change or explicitly inherit title, description, and location for
one selected occurrence without changing the series. Empty description or
location remains a meaningful override, and unsupported properties remain
available to other calendar clients without being rewritten by this editor.
Following-scope metadata, alarm cloning, arbitrary recurrence expansion, and
general editing of parameterized text properties remain outside this decision.

## Validation

Tests cover sparse text-only and combined timing writes, explicit empty text,
inheritance, source-presence mode when an override equals the master, moved
RECURRENCE-ID matching, named-zone DST projection for a new override, timing-only
clone compatibility, existing override updates, unsupported read-only text,
no-op bytes, revision handling, raw master/sibling preservation, malformed
runtime payloads before CalDAV reads, and editor scope and controls. Hosted
checks remain required for the exact candidate head before merge.
