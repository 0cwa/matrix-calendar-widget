# Calendar performance measurements

This benchmark measures the synchronous domain occurrence projection on
synthetic calendars. It does not measure the CalDAV gateway, network latency,
React/FullCalendar rendering, memory peaks, or a deployment's capacity. A
separate synthetic browser smoke measures one fixed 1,000-event calendar in
the actual list and month components; it is an observational UI measurement,
not a product latency or capacity target.

## Controlled beta 250-event pilot contract

This acceptance contract was approved and recorded on 2026-10-07 before any
measurement. It is a synthetic controlled-beta target, not a universal
calendar-size limit or a production-capacity claim. No 250-event real-client
measurement has passed yet.

The workload is one authorized Element Web session at 1280×800, with exactly
250 unique, simple timed VEVENTs across exactly 31 calendar days in
`Europe/Stockholm`. Events have no recurrence, alarm, attachment, or concurrent
load. Seed them sequentially through the fixture's authenticated CalDAV path;
do not use 250 widget saves or gateway POSTs. Keep identities and content in
process memory only.

Every measured sample has a strict limit: a calendar range request through
fully received and decoded JSON must take at most 1,000 ms; a real List or Month
view action through the stable populated widget DOM must take at most 2,000 ms;
and selecting an event through its stable details dialog must take at most
500 ms. A single over-limit sample fails the gate. Report all values, including
warm-ups, plus measured median and maximum; do not discard or retry slow
samples.

The cold first widget opening is measured from immediately before activating
the registered widget through automated approvals, selection of the exact
31-day List range in the real date picker, and the fully populated stable List
view containing all 250 events. The 2,000 ms limit includes widget startup,
capability approval, OpenID, range selection, API transfer and decode,
projection, and rendering. Record every calendar API response exercised by
this cold operation through full JSON decode and apply the 1,000 ms response
limit to each one. Record setup/authentication separately, and record startup
subphases for diagnosis, but do not subtract them from the cold total. Then
record two List and two Month warm-ups, followed by five measured List and five
measured Month samples, alternating views in the same session. After two
explicitly labeled detail warm-ups, measure five event-detail opens.

Start from Element's normal room state at the fixed 1280×800 viewport and open
the registered widget through the usual Room Info → Extensions → WidgetCard
path. Keep the widget in Element's standard side panel; do not Pin it into the
Apps drawer or use Maximise/Un-maximise. The cold timer includes first
activation, capability and identity approvals, and all ordinary widget startup
work. Record the actual WidgetCard placement and iframe width and height, and
require the host and widget document to have no horizontal overflow. Report the
observed dimensions without adding a minimum iframe-width threshold. Do not
seed layout state or simulate the side panel by resizing the browser window.
Pinning and maximized Apps-drawer layout certification are deferred and must
not be reported as passed by this pilot.

Use the real date-range picker to set the exact 31 local dates for List. Assert
the actual request range in memory. Month deliberately requests a wider range:
the repository adds seven days on either side, while the visible grid uses
whole weeks. Report the actual List and Month request spans separately and
count only the 250 seeded events in the chosen month; no seeded event belongs
to the Month padding days.

Record each sample and its fixed failure observations before asserting its
status, content count, range, or timing. A failed sample remains in the report;
no sample may be discarded or retried.

Each measured List response must be HTTP 200 with exactly 250 distinct expected
events and zero server/projection diagnostics; all 250 rows must appear once
and remain stable over two animation frames. Month must return the same 250
events with zero diagnostics; visible entries plus every overflow count must
sum to 250, and opening an actual overflow day must reveal its expected 8 or 9
events. Details timing includes query/rendering. Page errors, missing or
malformed responses, unexpected ranges, wrong counts, and any over-limit
sample fail the gate. The acceptance report retains every sample and exact
runner/client/service versions, with no URLs, query strings, IDs, titles,
headers, response bodies, ICS, tokens, profiles, screenshots, traces, raw logs,
or HAR files.

The complete execution sequence, timing boundaries, evidence schema, and
cleanup requirements are fixed in the approved private contract before the
hosted measurement. Results apply only to the recorded synthetic environment.

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
setting a pilot capacity or latency target. Windowed loading, reducing repeated
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
