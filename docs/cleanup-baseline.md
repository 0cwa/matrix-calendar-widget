# Calendar cleanup baseline

[Documentation](./README.md) · [Roadmap](./ROADMAP.md) · [Historical records](./archive/README.md)

Captured 2026-10-19 before the remaining widget/server retirement and
maintainability slices. This records measurements available for the current
source; missing historical data is called out instead of inferred.

## Source and validation

- Main commit: `a60db33dd47f7c74eb58d466d475458dacd132ba`
- Main tree: `2e422f0b0def9e4b626322e0943ee0c71dffe9b4`
- The source tree matches the reviewed #275 head `15f81ea8d92d062be38bfb6635f1f795e0be9645`.
- The full build completed locally in 18.93 seconds. Vite reported a main
  JavaScript bundle of 3,017.50 kB (680.52 kB gzip); this is a build output
  size, not a download or runtime measurement.
- Repository `yarn depcheck` passed across all workspaces.
- The captured build and dependency check did not record exact Node or Yarn
  versions. The repository pins Yarn `1.22.22` in `package.json`. This cleanup
  environment reports Node `v26.12.0`; the Yarn shim is unavailable, but the
  project Yarn package runs with `node /tmp/yarn-package/bin/yarn.js` and
  reports `1.22.22`. Do not compare the captured duration or bundle output
  against another toolchain as if it were a controlled comparison.
- Reproduction commands from the repository root in this environment:
  `node --version`, `node /tmp/yarn-package/bin/yarn.js --version`,
  `node /tmp/yarn-package/bin/yarn.js depcheck`, and
  `/usr/bin/time -p node /tmp/yarn-package/bin/yarn.js build`. Record the first
  two outputs with future build measurements.

## Protected and acceptance job durations

These results belong to the exact #275 source tree above, from PR #306 checks.
Hosted jobs ran concurrently, so durations are per job and are not additive.

| Check                         | Duration |
| ----------------------------- | -------: |
| Quality                       |   2m 17s |
| Widget                        |   6m 23s |
| Server and bot                |   3m 25s |
| Container image build smoke   |   2m 07s |
| Analyze JavaScript/TypeScript |   1m 23s |
| Element Web acceptance        |  13m 37s |
| Normal bot account acceptance |  14m 59s |
| Calendar browser layout       |   2m 56s |
| Real Radicale contract        |   3m 00s |

Source: [PR #306 check results](https://github.com/0cwa/matrix-calendar-widget/pull/306).
This is a single successful baseline run, not a duration distribution.

## Recent acceptance-run feedback

At capture time, the 15 most recent runs of the Element acceptance workflow
contained 14 completed runs: 6 succeeded and 8 failed; one was still running.
This sample includes different source changes and is not a product-failure
rate. The failing jobs expose a single combined acceptance-suite step, so the
available step metadata cannot distinguish fixture/setup failures from
behavior failures. The baseline for setup-only failures and time to first
actionable failure is therefore **unknown**.

## Current change-radius indicators

The largest files identified by issues #257 and #258 have these line counts on
the baseline tree:

| Module                          | Lines |
| ------------------------------- | ----: |
| `CalendarEventEditorDialog.tsx` | 2,309 |
| `GatewayCalendarRepository.ts`  | 1,139 |
| `CalendarGatewayController.ts`  | 1,693 |
| `ICalendarEventCodec.ts`        | 6,365 |

The acceptance harness has 76 matching Element/acceptance-related files under
`dev/` and `e2e/`. Its three central files are 3,932 lines for
`sanitize-element-acceptance.mjs`, 4,245 for `element-desktop-startup.mjs`,
and 8,336 for `elementCalendarAcceptance.spec.ts` (16,513 combined).

The last completed source-cleanup change, PR #306, touched six paths: one
runtime source file, two widget test files, and three planning/status files.
Its production change stayed in widget startup; the other listed concerns
were not changed in that patch. The baseline does not yet include comparable
feature-change path counts for reminder, networking, editor, gateway, or codec
changes; capture those before each corresponding extraction.

## Comparison rules

- Keep full acceptance and all security, preservation, cleanup, and accessibility
  gates. A smoke profile may supplement full acceptance only if it provides
  measurably faster actionable feedback.
- Compare the same source-bound check names and count setup-only failures only
  when a sanitized failure phase identifies them.
- Compare module change radius using representative follow-on changes; file
  size or lines moved alone do not count as improvement.
- Rebuild on the same Node/Yarn toolchain before comparing bundle output.
