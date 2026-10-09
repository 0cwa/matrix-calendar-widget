# Calendar performance measurements

This benchmark measures the synchronous domain occurrence projection on
synthetic calendars. It does not measure the CalDAV gateway, network latency,
React/FullCalendar rendering, memory peaks, or a deployment's capacity. A
separate synthetic browser smoke measures one fixed 1,000-event calendar in
the actual list and month components; it is an observational UI measurement,
not a product latency or capacity target.

## Controlled beta ordinary-load contract

The approved beta performance gate covers ordinary Element Web use with an
empty default calendar view and a 25-event default calendar view. It replaces
the earlier 250-event timing target; it does not claim that every calendar up
to 25 events behaves the same on every host or establish production capacity.
The 250-event run and custom 31-day timings are diagnostic only. Previous
250-event attempts did not produce a passing measured timing series; successful
seeding or cleanup is not performance evidence.

Use two fresh authorized synthetic Element Web browser contexts at 1280×800 in
the standard side-panel WidgetCard layout. The first context observes an empty
calendar. Then seed exactly 25 unique simple timed VEVENTs into the same room
calendar for the current seven-day interval in Europe/Stockholm through the
authenticated CalDAV fixture path. Then use a second fresh context for the
populated case. The empty calendar may be genuinely empty. Keep identities and
content in process memory only; track every owned create and delete.

The strict limits apply to every required sample:

- Cold widget activation through a usable, stable default seven-day List view:
  **≤ 2,000 ms** in both contexts.
- A visible List date-range-picker refresh back to that same seven-day
  interval, through a usable, stable List view: **≤ 2,000 ms**.
- Each required non-OpenID calendar API response, including context,
  calendar-metadata, and event-range requests, through full receipt and JSON
  decoding: **≤ 1,000 ms**. OpenID timings are recorded separately.
- Five event selections through their stable details dialogs in the 25-event
  case: **≤ 500 ms** each. No details sample is required for the empty case.

Prepare synthetic identities, membership, widget registration, Element host
login, and room navigation before measurement and record their outcomes
separately. Start the cold timer immediately before normal widget activation.
Include widget startup, capability and identity approvals, OpenID exchange,
API transfer and decode, projection, and rendering. End only when the matching
default seven-day response is decoded, the exact 0 or 25 expected events are
rendered, usable controls are visible, and the content is stable across two
animation frames. Do not include custom date-picker navigation in the cold
timer or pre-open the widget or bypass authentication.

Use the visible List date-range picker for the measured refresh. First select
the adjacent seven-day interval beginning seven days after the original start
date. Record its decoded response and stable zero-row List content as setup;
the adjacent interval contains none of the 25 events seeded in the original
interval. Setup has no separate 2,000-ms action limit, but its required
calendar API response still has the 1,000-ms limit. Start the refresh timer
before opening the date-range picker and selecting the exact original seven-day
interval. This includes every picker action and requires a new exact room-events
response, full decoding, and stable correct List content; a cached render
without a new matching response is incomplete. The standard side-panel iframe
can be narrower than the 800-pixel breakpoint that enables Month, so the test
uses only controls available in the measured layout. Do not force cache
invalidation or add a refresh control for the test.

Retain one cold and one refresh sample in each fresh context, plus five details
samples in the 25-event case. Require HTTP 200, exact interval and event
identity, returned and rendered counts of 0 or 25 as applicable, zero
projection diagnostics, usable controls, and stable content. Every required
non-OpenID calendar API response in both cases, including refresh setup, must
meet the 1,000-ms limit. Record every designated sample and fixed failure
observation before assertions. Keep all observations: no authentication
bypass, retries, discarded failures, best-of selection, or phase subtraction.
Missing or malformed data, unverified page errors, overflow, fixture cleanup
failures, or an over-limit required sample fails the gate. For this profile,
`widget-open` begins immediately before normal widget activation and remains
through identity exchange, approvals, and initial loading. It ends as soon as
the first contract-ready default List observation has one decoded HTTP 200 room
response for the exact calendar and range, exact returned and rendered event
identities, a visible and enabled Create event control, and content stable over
two animation frames. The stage changes at that observation, before waiting
for unrelated requests to settle; this does not move the cold timing stop or
add requests.

The only approved page-error diagnostic exception applies to future reports:
every such error must occur during `widget-open`, and its complete,
untruncated stack must parse with the first frame and every captured frame on
the configured Element static origin under the pinned production-bundle path.
Widget-origin, mixed-origin, other-origin, unknown, malformed, truncated,
overflowed, or after-readiness errors still fail. The check does not use a
source-map namespace or infer a cause, fix, or harmless behavior from the
stack. It records only closed labels, booleans, and capped frame counts; error
messages, names, stacks, URLs, and paths are not retained.

This conditional diagnostic applies only to the ordinary performance profile.
The profile must still pass every startup, timing, decoded API, identity,
authorization, range, content, cleanup, and details assertion. Every exact
candidate must also pass its required repository checks and separate Element
Web/Desktop, CRUD, reminder, restore, and operator gates. An ordinary profile
result alone never establishes beta acceptance. Earlier reports retain their
original fail-closed outcomes; the recorded opening errors remain unverified
and their cause is unknown.

Open the registered widget through Element's usual Room Info → Extensions →
WidgetCard path. Record the actual placement and iframe width and height, and
require no horizontal overflow in the host or widget document. Do not impose a
minimum iframe-width threshold, seed layout state, or simulate the side panel by
resizing the browser window. Pinning and maximized Apps-drawer layout
certification are deferred and must not be reported as passed.

Sanitized receipts contain only closed labels, booleans, capped counts,
statuses, numeric timings, runtime versions, and exact source/run references.
They contain no URLs, hosts, identifiers, titles, tokens, headers, bodies, ICS,
profiles, screenshots, traces, raw logs, or HAR files. Results apply only to
the recorded synthetic environment and do not certify an operator capacity
envelope.

### Historical 250-event diagnostic

The 250-event workload was previously proposed as a beta timing target. That
target is superseded. Its prior hosted attempts reached the exact seed and
cleanup checks but failed before producing a complete measured timing series.
Keep those receipts labeled as 250-event diagnostics; do not infer a passing
250-event latency or capacity claim from fixture setup, successful cleanup, or
partial instrumentation.

## Reproduce

Use the locked dependencies and build the linked packages first:

```bash
yarn install --frozen-lockfile
yarn workspace @matrix-calendar-widget/ical-timezones build
yarn workspace @matrix-calendar-widget/calendar build
node scripts/benchmark-calendar-projection.cjs
```

The script warms each case once, then records three samples with
`performance.now()`. It reports median and maximum elapsed time, runtime,
architecture, projection range, output counts, and diagnostic reasons as JSON.
Every sample asserts exact occurrence and diagnostic counts. A count mismatch
fails the command. Elapsed time has no pass/fail threshold because machine load
and runtime affect it. CI runs this same command after building the calendar
package, so the hosted job retains fresh measurements for its exact source.

All cases use a half-open October 2026 UTC window and the Europe/Stockholm
viewer timezone, including the fall clock transition. Data is generated locally;
no credentials, user calendar contents, or event details are fetched or emitted.

## Initial measurement

Measured on 2026-10-03 from main `b8364f4c652038c930e5ebf427dbbaf0ded35a75`
with the benchmark script added, using Linux x64 / Node 24.19.0. The shared
development runner had concurrent validation jobs. These are observational
results from that environment, not a controlled capacity baseline. The hosted
CI runtime is Node 22; consult its job output for that runtime's results.

| Scenario                     | Resources | Occurrences | Diagnostics | Median ms | Maximum ms |
| ---------------------------- | --------: | ----------: | ----------: | --------: | ---------: |
| Single events                |    10,000 |      10,000 |           0 |  2,547.50 |   3,596.22 |
| Daily series across fall DST |       500 |      15,500 |           0 |  9,472.20 |  17,799.54 |
| Weekly series                |     1,000 |       5,000 |           0 |  3,686.98 |   4,681.30 |
| Historical SECONDLY series   |         1 |           0 |           1 |      0.98 |       1.98 |

The historical high-frequency case returns an `occurrence-limit` diagnostic,
not an empty calendar declared complete. Existing projection limits include
512 candidates per resource, 100,000 historical scan steps, and 4,096 combined
recurrence input members. These bounds limit individual-resource expansion;
they do not bound the aggregate number of resources or rendered events.

The large daily workload takes seconds in this environment. It therefore does
not establish that a large calendar remains interactive. The fixed browser
workload below is only one rendered input size. Follow-up evaluation must
measure varied realistic inputs, memory, and a controlled runtime before
setting a broader capacity envelope. Windowed loading, reducing repeated
timezone work, and off-main-thread projection are candidate improvements to
measure before adopting them.

## Synthetic browser render measurement

The Chromium fixture's `large-calendar` mode uses an in-memory repository with
1,000 uniquely named, one-off timed events distributed across October 2026.
It renders the production `CalendarToolbar` and `CalendarEventsSurface` at
1280×800. The browser test warms each view once, then captures five
fresh-navigation samples for list and month. Its timer starts immediately before
`createRoot().render`, waits until the list has all 1,000 event rows or month
view has its 31 overflow links, and records elapsed time after two animation
frames. For month samples, it also follows a real overflow link to list view
and verifies that all 1,000 expected event names are present exactly once.
An in-page observer stores the ready timestamp before Playwright waits for the
result, so test-driver round trips after the DOM is populated do not extend the
reported duration.

Run it after installing the locked dependencies and building the linked
packages:

```bash
yarn workspace @matrix-calendar-widget/ical-timezones build
yarn workspace @matrix-calendar-widget/calendar build
yarn workspace e2e playwright install --with-deps chromium --only-shell
yarn workspace e2e playwright test --config playwright.calendar.config.ts --grep "1,000 event"
```

The Playwright JSON attachments contain the warm-up, five elapsed samples,
median and maximum, browser metadata, event/list counts, overflow-link count,
horizontal dimensions, and (where supported) only a long-task count and
maximum duration. There is no elapsed-time threshold. The check fails on
missing or duplicate list entries, page errors, horizontal overflow, or a
broken month overflow path. The timer excludes navigation,
script download/evaluation, and i18next initialization. The fixture data is
already constructed in memory, so this is only a fixture mount-to-populated-DOM
measure; it is not a data-load or domain-projection benchmark. This fixed
workload does not measure memory, gateway/network latency, real user calendars,
or a controlled runtime, and it must not be used to claim pilot capacity or
production responsiveness.

### Hosted measurement, 2026-10-06

All twelve browser cases passed in [run 37481392793](https://github.com/0cwa/matrix-calendar-widget/actions/runs/37481392793),
browser job `112330122875`, at source commit
`1af82dee25e2365c7083c860e65fec94b2bffa14` / tree
`911027044f96463a06e7d42cd2371ecf333662f7`. The runner used Linux x64,
Node 22, and Headless Chromium 149.0.7827.55. The fixture initializes locale
with the production helper and gives the month grid the production viewport
height chain. It exercises a normal pointer click on the overflow link.

The [retained JSON](./evidence/calendar-browser-20261006.json) includes the
warm-up, five raw samples per view, environment, counts, horizontal dimensions,
and optional long-task summaries from artifact `11421332275`.

| View  | Median mount ms | Maximum mount ms | Maximum sampled long task ms |
| ----- | --------------: | ---------------: | ---------------------------: |
| List  |          947.30 |          1044.50 |                          586 |
| Month |         2819.90 |          2898.70 |                         2631 |

Each list sample returned exactly 1,000 unique expected titles. Each month
sample accounted for 62 visible events plus 938 hidden events across 31
overflow links, then returned the same 1,000 unique titles after clicking one
link. Document and surface widths stayed within the 1280-pixel viewport.
There were no browser page errors.

The month render includes a long task of up to 2.63 seconds in these samples.
Passing the count and layout gates does not establish interactivity at this
size. Varied recurring workloads, memory peaks, loading, and a controlled
capacity target remain open. These numbers cover the prepared fixture's
mount interval only, with the exclusions above.
