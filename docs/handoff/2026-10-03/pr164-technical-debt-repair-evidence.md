# PR164 technical debt repair evidence

## Candidate and scope

- PR: #164, `codex/m6-appservice-room-access-20261002`
- Original remote head/base: `a46f885984e7a7ba2e9f576fbe974122f4e30758` / `d1cd5f026198b55c1fdf0eb34fa96ee480a5d3b0`
- Current main merged forward: `f24a4979a052b2a293144b3192eeee0cc2e17fa6`
- Current local candidate: `b736d8f26b5bb36d39e7a20ed13924d39c84099a`
- Repair commits: `ee1d0b8` (type fix), `072d4eb` (preflight and diagnostic cleanup)
- No product authorization or calendar behavior changed. The repair changes test typing and CI failure visibility; the Personal OpenID, room AppService, and cross-room Radicale contract cases remain configured.

## Confirmed failure and cause

`PersonalOpenIdRadicaleContract.test.ts` imported Express's `Response` under the global Fetch name. `matrixJson` then declared its Fetch result as Express `Response`: TypeScript TS2740 at the assignment near line 660 and TS2339 for `.ok` near line 672. The test imports and suite markers did not catch this compile-time collision.

The server `tsconfig.json` includes only `./src/**/*`; it excludes `test/`. That is why routine `yarn tsc` passed while Jest could not load this test file. The focused fix aliases the Express type as `ExpressResponse` and uses it only for middleware.

## Deterministic regression and diagnostics

`.github/workflows/caldav-contract.yml` now runs `CALDAV_CONTRACT=0 yarn workspace @matrix-calendar-widget/server jest test/integration/PersonalOpenIdRadicaleContract.test.ts --runInBand` before starting containers. Jest's ordinary output exposes the concrete compile error and source location; all three real Personal OpenID cases are skipped in this preflight. The later real contract run still scans and removes raw output, then emits only allowlisted suite/case and setup-stage summaries.

Removed the ineffective runner/module probe markers and the broad category classifier. Jest 30 stored this compile failure in `suite.message`, while the old category code inspected `testExecError` and reported `unknown`. Routine import failures now get actionable preflight output without a new diagnostics framework.

## Changed paths

Repair-specific changed paths across the two repair commits:

- `.github/workflows/caldav-contract.yml`
- `dev/caldav-contract-status.mjs`
- `dev/sanitize-caldav-contract-stage.mjs`
- `dev/sanitize-caldav-contract-stage.test.mjs`
- `dev/sanitize-server-test-report.mjs`
- `dev/sanitize-server-test-report.test.mjs`
- `matrix-calendar-server/setupTests.ts`
- `matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts`
- Deleted `dev/sanitize-personal-openid-import-probe.mjs` and its test
- Deleted `matrix-calendar-server/test/util/PersonalOpenIdContractProbe.test.ts`, `PersonalOpenIdContractProbe.ts`, `PersonalOpenIdImportProbe.test.ts`, `PersonalOpenIdRunnerMarker.test.ts`, and `PersonalOpenIdRunnerMarker.ts`

## Checks and comparison

- Node 22 Personal OpenID import preflight: passed; 1 suite and 3 contract cases skipped as intended.
- Diagnostic unit tests: 4 test files passed (`caldav-contract-status`, `sanitize-server-test-report`, `sanitize-caldav-contract-stage`, `synapse-startup-diagnostic`).
- Post-forward-merge Server/bot Jest suite: passed under host loopback access; sanitized report was `server-test-report no-failures`.
- Membership guard regression: 4/4 passed on both PR164 and current main with host loopback access. The earlier sandbox-only failure was `listen EPERM` at the test server bind; it was not a product regression.
- Current-main comparison: clean frozen/offline install, timezone package build, calendar package build, and `yarn tsc` passed. The earlier TS2322 observation came from linking the PR worktree's stale generated workspace types into the comparison worktree and is discarded.
- Commit hooks passed lint, TypeScript, dependency checks, translation dry-run, and formatting. The aggregate-order issue was reproduced on a separate clean worktree at current main `f24a497` after frozen/offline install and removal of generated package outputs: root `yarn ci` exited 1, its command positions were `test:all` fifth and `build` sixth, and Widget reported 86 failed / 48 passed files. The first missing import was `@matrix-calendar-widget/ical-timezones/lib/index.js`. The smallest command-order fix is to build `ical-timezones` and `calendar` before `test:all`, as the hosted Widget job already does. This is separate debt and is not changed in PR164.
- Real Synapse/Radicale contracts have not run locally; final acceptance remains tied to hosted checks on the pushed candidate.

## Hosted status

The exact candidate was pushed forward-only and remains draft:

- Remote ref: `origin/codex/m6-appservice-room-access-20261002`
- Head: `b736d8f26b5bb36d39e7a20ed13924d39c84099a`
- Base: `f24a4979a052b2a293144b3192eeee0cc2e17fa6`
- PR: [#164](https://github.com/0cwa/matrix-calendar-widget/pull/164)

On this exact head, Quality, Widget, Server and bot, Analyze JavaScript/TypeScript, Container image build smoke, and CodeQL passed. Real Radicale contract failed in run `37125383344` / job `111209519545`.

The hosted artifact retained only sanitized labels: Personal OpenID setup completed; room AppService setup was not reached; the room suite was marked failed with the three labels `room-appservice-cross-room-denial`, `room-appservice-exact-binding`, and `room-appservice-subject-binding`. The artifact contained no assertion count, exception text, or source frame. A direct Node 22 `CALDAV_CONTRACT=0` preflight for the room integration file passed, ruling out import/compile failure. The failure therefore occurs in or before room AppService fixture setup; the actual cause and environment-versus-code classification remain unknown. Do not infer an authorization defect from the three case labels because the suite never proved those assertions ran.

Next diagnostic action for the web successor: update the existing real-contract failure artifact to preserve the room suite's assertion count and, when setup fails before assertions, only the exception class plus one repository source frame from Jest's suite-level error. Apply the existing sanitization boundary and never expose credentials, authorization data, URLs, or complete ICS. Re-run the real Radicale contract on the exact candidate before changing room authorization behavior. Local container reproduction was not started; do not touch existing shared volumes.

PR #164 remains open and draft. The real Radicale contract is the sole failed required check; the central integration owner handles review and any merge. The CI prerequisite-order repair is intentionally separate in draft PR #179.
