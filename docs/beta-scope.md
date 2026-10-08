# Controlled beta scope and acceptance

_Status: bounded scope defined; acceptance evidence is not complete._

This document defines a controlled beta candidate for later team-server use,
using the currently implemented product subset. It separates candidate
readiness from the broader M4, M5, and M8 milestones. Passing these gates does
not publish an artifact, authorize a live rollout, or establish compatibility
with a team host, every Matrix client, or every CalDAV resource.

## Intended pilot

The candidate is for one trusted organization and its explicitly configured
room calendars. Element Web and Element Desktop are the only client targets in
this beta. The operator records the exact app, browser, and operating-system
versions tested. The service runs as one gateway replica because the gateway
and bot limits are process-local and reminder scheduling assumes one replica.

The selected deployment shape uses the project-owned Radicale image with its
own independent calendar store, plus a separate application-owned PostgreSQL
database for Matrix reminder state. PostgreSQL is not Synapse's database.
Room calendars and bindings are operator-provisioned. The baseline does not
reuse, attach, import, copy, migrate, or modify an existing Radicale data
directory. If an operator chooses to reuse an existing service or store,
image replacement, data-path compatibility, preservation, backup, restore,
and rollback become additional acceptance work under
[ADR037](./adrs/adr037-independent-radicale-store-for-controlled-beta.md) and
[ADR024](./adrs/adr024-in-repo-radicale-openid-auth.md).

Room reads, event writes, reminder configuration, reminder delivery, and room
action notices remain separate default-off capabilities. An operator enables
only the capabilities included in the reviewed pilot. Scheduled reminders use
whole-room `m.mentions.room` in unencrypted rooms; encrypted or unknown room
state is unsupported and must fail closed. Delivery is not exactly once.

## Supported behavior and limits

The beta covers room-bound VEVENT calendars and the implemented bounded event
editor, recurrence, alarm, conference-link operations, and one safe HTTP(S) URI
attachment operation on an unambiguous master event. Attachment authoring is
limited to the add, replace, or remove operation defined by
[ADR038](./adrs/adr038-bounded-safe-uri-attachment-authoring.md); opaque,
binary, unsafe, ambiguous, occurrence, and following attachment data remains
outside the editor's authoring support and is preserved where supported. The
detailed data contracts remain in [ADR023](./adrs/adr023-floating-recurrence-semantics.md),
[ADR028](./adrs/adr028-room-reminder-configuration-and-delivery.md),
[ADR029](./adrs/adr029-recurrence-instance-timing-edits.md),
[ADR031](./adrs/adr031-safe-calendar-external-links.md),
[ADR032](./adrs/adr032-room-calendar-action-messages.md),
[ADR033](./adrs/adr033-room-reminder-alarm-options.md),
[ADR034](./adrs/adr034-bounded-following-timing-edits.md),
[ADR035](./adrs/adr035-monthly-ordinal-weekday-recurrence.md),
[ADR036](./adrs/adr036-bounded-conference-link-authoring.md),
[ADR038](./adrs/adr038-bounded-safe-uri-attachment-authoring.md),
[ADR039](./adrs/adr039-calendar-absolute-display-alarm-metadata.md), and
[ADR040](./adrs/adr040-selected-occurrence-text-fields.md). Authentication,
room authorization, and the separate-store deployment choice remain governed
by [ADR014](./adrs/adr014-split-widget-and-bot-calendar-principals.md),
[ADR015](./adrs/adr015-server-managed-room-calendar-bindings.md),
[ADR024](./adrs/adr024-in-repo-radicale-openid-auth.md), and
[ADR037](./adrs/adr037-independent-radicale-store-for-controlled-beta.md).
Absolute UTC DISPLAY alarms remain calendar metadata and cannot be delivered
as Matrix room reminders. Reminder configuration and delivery continue to use
the supported relative-trigger contract under ADR028.

CalDAV remains canonical. Existing mixed collections and unknown properties
are preserved where supported edits allow it; the widget does not normalize
unsupported members destructively.

The widget does not guarantee that every source VEVENT can be projected.
Unsupported or malformed recurrence and timezone data that the bounded
projector cannot handle may be omitted from the visible projection. For source
forms the projector diagnoses, the widget shows an affected-event
compatibility warning; it does not guarantee every unsupported form will be
diagnosed. The original resource remains in CalDAV. A calendar view with no
visible warning is not a general-purpose CalDAV export or proof that every
resource is understood. Beta material and operator handoff must state this
limit clearly.

The beta does not include arbitrary RRULE or recurrence editing, general
RECURRENCE-ID property editing, collection-timezone editing, broad
iCalendar/client interoperability claims, attendee or email authoring,
individual Matrix reminder recipients, encrypted scheduled reminders, mobile
or other Matrix clients, or formal screen-reader certification. The
project-owned Radicale backend is OpenID-only and does not provide a
conventional CalDAV client login. Ordinary CalDAV login using a Matrix
password is unsupported. The widget never asks for or stores Matrix passwords.

The existing 1,000-event browser fixture is reference evidence, not a promised
calendar-size limit or performance guarantee. Its month-view samples include a
long task of about 2.63 seconds. The approved controlled-beta performance gate
uses fresh Element Web contexts with an empty default seven-day List view and
exactly 25 simple events in that same interval. Cold activation and a normal
same-range view refresh must each complete within 2,000 ms; every required
non-OpenID calendar API response must decode within 1,000 ms; five details
samples in the 25-event case must each complete within 500 ms. Custom 31-day
and 250-event timing runs are diagnostic only. The full method is in
[`calendar-performance.md`](./calendar-performance.md#controlled-beta-ordinary-load-contract).
These are acceptance targets for the measured synthetic environment, not a
universal event-count limit or production guarantee; no result is claimed
until an exact-candidate hosted run records every required sample.

## Required acceptance evidence

Complete these gates against the exact candidate source commit. Keep evidence
synthetic and sanitized; do not put production hostnames, addresses, SSH
aliases, configuration, logs, or topology in repository artifacts.

1. **Repository and hosted checks.** The candidate head must pass the five
   existing protected CI contexts unchanged. For the candidate, also retain
   the relevant hosted Calendar browser-layout result and the path-triggered
   real Radicale/PostgreSQL contract result. These are additional candidate
   evidence, not a change to the five required branch-protection contexts or
   a claim that every workflow is a universal beta gate. Record each result
   against the exact tested head.
2. **Isolated client acceptance before any production contact.** Use the
   pinned local Synapse, project-owned Radicale, and PostgreSQL test services
   with real Element Web and Element Desktop clients. Use synthetic rooms,
   users, calendars, and events. Test widget capability approval, room binding,
   calendar loading, event create/edit/delete, conflict recovery, and reminder
   settings. Record client, browser, operating-system, service, and candidate
   versions. This proves only the tested local stack; it does not establish
   compatibility with a team host. A production rollout needs a separate
   explicit gate after this acceptance is complete.

   The Desktop startup harness must prove its exact dual-stack OUTPUT policy
   for packets emitted by the isolated Desktop UID at each counter snapshot
   and pass its loopback deny probes. Every snapshot must be complete and
   non-overflowing. Report blocked DROP counts and fixed protocol classes even
   when attempts occur; a DROP count is evidence of denied traffic, not
   successful external egress or attribution to a particular process or
   request. Trusted controller loopback operations and fixture services are
   scoped separately. This harness does not measure all runner traffic or
   claim that the client made no network attempts. Missing or changed policy
   rules, unavailable counters, or partial counters fail the
   `networkIsolationVerified` gate.

3. **Authorization and stale-write behavior.** Exercise two independent
   Matrix identities: an authorized actor succeeds, and a second actor is
   denied for an unauthorized room operation before service-principal proof
   issuance or CalDAV I/O. Where the pilot distinguishes read and write power,
   verify the lower-power actor cannot write. Perform a concurrent edit with a
   stale strong ETag and verify the stale write is rejected without replacing
   the first successful change. Confirm current membership, binding, and
   action-power checks remain enforced by the server.
4. **Projection and keyboard behavior.** Include a synthetic unsupported
   recurrence/timezone resource covered by the current projector diagnostics
   and verify the widget shows its affected-event warning while leaving
   canonical source data intact. This check does not claim every unsupported
   source form is diagnosed. In each target client, use only the keyboard to
   reach and open an event, move through its details, close with Escape, and
   verify focus returns to the opening event. For this candidate, certify the
   actual standard side-panel WidgetCard and horizontal-overflow behavior.
   Pinned/full-width Apps-drawer placement and its Maximise/Un-maximise
   controls are deferred.
   Automated axe and component fixtures supplement these checks; they do not
   replace them.
5. **Reminder behavior.** Configure the app-owned PostgreSQL store and verify
   a supported reminder in an unencrypted synthetic room. Verify encrypted
   and unknown room state is refused. Record that reminder state is separate
   from canonical CalDAV data and that the pilot uses one server replica.
6. **Restart and restore.** Restart the single server and confirm the
   authorized calendar and reminder paths recover. Separately back up and
   restore both the Radicale store and the application PostgreSQL store into
   an isolated clean environment. Verify representative calendar resources,
   bindings/configuration, and expected reminder state after restoration.
   Keep the two stores' recovery procedures and results distinct.
7. **Measured pilot envelope.** Before measuring, record the operator-approved
   enrollment/workload boundary and pass thresholds. Record hardware and
   resource limits, operating system and runtime versions, service versions,
   one-replica topology, displayed date range and event/occurrence counts, and
   API and widget-render latency samples. Include the measurement method and
   observed percentile/max values. The candidate passes only within the
   pre-declared thresholds; results do not promise behavior beyond the tested
   envelope.
8. **Operator review.** Review the proposed room bindings and service-principal
   trust boundary, secrets, HTTPS and proxy behavior, OpenID query-token log
   redaction, PostgreSQL TLS/role, network exposure, enabled capability gates,
   backups, restore, and rollback. This pre-contact review does not log in to
   or inspect a production service. Use the project-owned Radicale store for
   the baseline beta. Any alternate image or existing-store reuse must pass
   its additional compatibility and recovery gates before use. Target-side
   checks require a separate explicit gate after the local evidence and review
   are complete; publish only a sanitized summary.

The evidence record must include the exact candidate commit, test date, client
and service versions, gate owner, pass/fail result, measured threshold and
result where relevant, and sanitized evidence location. Keep target identity
and other sensitive deployment details outside this repository.

## Beta readiness decision

The bounded candidate is ready for a separate rollout review only when every
applicable gate above has recorded evidence and an independent reviewer has
checked the exact candidate commit. That review is a final decision point; this
contract itself authorizes no production connection, publication, or rollout.
M4, M5, and M8 can remain open for their broader work while a candidate meets
this narrower contract. Mobile clients, other CalDAV clients, formal
screen-reader certification, broader recurrence/iCalendar support, and
general capacity characterization remain deferred.
