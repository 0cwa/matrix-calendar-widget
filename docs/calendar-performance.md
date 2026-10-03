# Calendar projection benchmark

This benchmark measures the synchronous domain occurrence projection on
synthetic calendars. It does not measure the CalDAV gateway, network latency,
React/FullCalendar rendering, memory peaks, or a deployment's capacity. The
current implementation runs synchronously; the measurements below identify
large input workloads that still need product performance work.

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
not establish that a large calendar remains interactive. Follow-up evaluation
must measure actual calendar loading and rendering, realistic input sizes,
memory, and a controlled runtime before setting a pilot capacity or latency
target. Windowed loading, reducing repeated timezone work, and off-main-thread
projection are candidate improvements to measure before adopting them.
