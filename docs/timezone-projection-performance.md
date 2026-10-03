# Reusing exact timezone transition instants

The bundled timezone adapter now computes UTC transition instants and the local
wall-time boundaries on each side once, when it constructs its cached exact
transition list. Conversion and DST-gap checks reuse those numeric values,
instead of constructing a Date for every transition on every lookup. The
ordered lookup rules, bundle, initial offsets, and cache coverage are unchanged.
No event data or conversion-result cache is introduced.

Regressions cover both edges of Stockholm spring gaps and autumn overlaps,
explicit RFC wall-time interpretation versus generated-gap rejection, and
historical second-resolution Kolkata offsets after newer cache coverage.
All 270 calendar-package tests pass.

## Observed synchronous projection timings

These measurements use the synthetic script from PR #184, one warm-up and three
samples per case, on Linux x64 / Node 24.19.0. The baseline is main
`652b722a05f01a2604222068caff636fe128d9f4`; the candidate changes only the
transition-index implementation and its tests. Both were independently built
and checked exact occurrence/diagnostic counts. The development runner was
shared with other validation work, so these are observations rather than
controlled latency or capacity guarantees.

| Scenario                     | Resources | Occurrences | Baseline median ms | Candidate median ms |
| ---------------------------- | --------: | ----------: | -----------------: | ------------------: |
| Single events                |    10,000 |      10,000 |           2,429.55 |            1,309.25 |
| Daily series across fall DST |       500 |      15,500 |           7,650.08 |            4,153.11 |
| Weekly series                |     1,000 |       5,000 |           4,401.02 |            1,084.26 |
| Historical SECONDLY series   |         1 |           0 |               0.98 |                0.51 |

The last case still yields exactly one `occurrence-limit` diagnostic. The other
cases yield none. Candidate maximums were 1,911.10 ms, 4,995.54 ms, 2,211.36 ms,
and 0.52 ms respectively. Baseline maximums were 4,219.07 ms, 7,685.29 ms,
4,860.50 ms, and 79.19 ms. The small final-case timing is especially sensitive
to scheduling noise.

The daily workload still takes seconds synchronously. This change does not
establish UI responsiveness, memory use, CalDAV/network performance, or actual
Element client capacity. Those remain separate pilot validation work. The
benchmark's count assertions, not elapsed-time thresholds, are the deterministic
CI gate; hosted Node 22 measurements should be evaluated separately.
