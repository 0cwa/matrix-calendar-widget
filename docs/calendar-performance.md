# Calendar performance measurements

This benchmark measures the synchronous domain occurrence projection on
synthetic calendars. It does not measure the CalDAV gateway, network latency,
React/FullCalendar rendering, memory peaks, or a deployment's capacity. A
separate synthetic browser smoke measures one fixed 1,000-event calendar in
the actual list and month components; it is an observational UI measurement,
not a product latency or capacity target.

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
