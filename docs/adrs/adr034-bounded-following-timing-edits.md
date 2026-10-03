# ADR034: Bounded this-and-following timing edits

- Status: Accepted
- Date: 2026-10-03

## Context

ADR029 supports one occurrence's timing within one ETag-protected CalDAV
resource. Following edits must preserve that resource boundary, the original
recurrence identities, and opaque calendar data. Splitting an arbitrary RRULE
into resources would introduce a multi-resource transaction and new UID,
alarm, and reminder-sidecar semantics. The initial following scope instead
supports a finite series that can be materialized safely in its existing
resource.

## Decision

1. The wire operation is `recurrence.following` with exactly
   `{ action: 'set-timing', recurrenceId, timing, viewerTimezone }`.
   `timing` has explicit `start` and `end` endpoints. The selected typed
   recurrence identity must be an actual member of the master rule. The
   viewer timezone is validated projection context, not a timezone mutation.
2. Accept only the editor-supported DAILY, WEEKLY, MONTHLY, or YEARLY RRULE
   subset with a positive interval and COUNT from 1 through 128. The supported
   plain weekly BYDAY subset and optional WKST=MO remain subject to ADR023.
   Reject unbounded rules, UNTIL, other rule parts, RDATE, EXDATE, EXRULE,
   master RECURRENCE-ID, unsupported timezone/recurrence data, and any VALARM
   on the same UID's components. Reject cancelled masters and duplicate,
   unknown, or parameterized master STATUS. Raw timing must pass the strict
   typing checks; `TZID=UTC` remains unsupported rather than being rewritten
   into UTC `Z` identity.
3. Materialize the selected occurrence and every later rule member as
   detached VEVENTs in the same resource, with the master's UID and each
   member's original typed RECURRENCE-ID. Leave the source master, RRULE,
   earlier occurrences, unrelated components, and calendar envelope intact.
   Clone the master's supported metadata and unknown properties, remove
   recurrence generators from each clone, and change only timing, recurrence
   identity, and the revision metadata described below. Do not use
   RANGE=THISANDFUTURE, create a new UID, or infer alarm/reminder metadata.
4. DATE timing uses a constant whole-day start shift and the submitted
   positive whole-day duration. Timed values retain their floating, UTC, or
   named timezone form: apply one constant wall-clock shift to later starts
   and reuse the submitted elapsed duration. Validate every resulting start
   and end against the bundled timezone rules; any DST gap or ambiguous fold
   rejects the complete operation before writing.
5. Initial authoring rejects existing detached overrides. The write boundary
   permits a retry only when all existing overrides form one complete,
   same-status, uniform suffix with otherwise matching source component
   shapes, and the requested result is identical. Return the original bytes
   and revision metadata for that no-op. Arbitrary, partial, unrelated, or
   changed detached suffixes remain unsupported; this phase does not rewrite
   a previously materialized suffix.
6. Before cloning, estimate resource growth from source and master UTF-8
   bytes plus per-clone overhead. Enforce an actual 4 MiB result limit, then
   enforce `min(4 MiB, configured event response cap)` before either personal
   or room PUT. Fail closed rather than truncate the series. Use one clock
   snapshot and ADR025 revision updates for the new detached components;
   leave the master revision unchanged. Unsafe revision data rejects cloning.
7. Require exactly one concrete strong caller ETag for updates. A supported
   byte-identical no-op skips PUT only when that ETag matches the current
   resource. Otherwise retain the conditional-write conflict behavior. The
   UI offers the timing-only scope only after the bounded planner accepts the
   selected series; the server and repositories repeat validation.

## Consequences

This completes the bounded timing-only occurrence/following/series choice.
It does not claim arbitrary RRULE splitting, general following-property
editing, alarm cloning, or cross-client interoperability. Unsupported sources
retain their canonical bytes and remain available for supported ordinary
operations. Actual calendar-client interoperability remains a release gate.

## Validation

Targeted tests cover finite-count membership and bounds, a middle-of-series
selection, named timing, cancelled and malformed STATUS, noncanonical raw
timezone typing, source/master property preservation, revision updates, exact
retry no-ops, stale and wildcard/weak/list ETags, and configured pre-PUT byte
limits. Widget tests cover scope selection and
fresh occurrence timing after conflict reload. Hosted checks remain required
for the exact candidate head before merge.
