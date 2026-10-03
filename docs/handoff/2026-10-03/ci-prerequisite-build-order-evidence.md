# Root CI prerequisite build-order debt

## Reproduction

- Clean current-main base: `f24a4979a052b2a293144b3192eeee0cc2e17fa6`.
- Environment: Node 22.23.3, Yarn 1.22.22, frozen/offline install, generated package outputs removed.
- Baseline `yarn ci`: exit 1. The root `package.json` runs `test:all` fifth and `build` sixth, so Widget tests import the linked timezone workspace before it has been compiled.
- Sanitized Vitest summary: 86 failed / 48 passed files; first missing entry point was `@matrix-calendar-widget/ical-timezones/lib/index.js`.

## Repair and proof

- Separate branch: `codex/ci-prerequisite-build-order-20261003`, based directly on current main.
- The root `ci` command now builds `@matrix-calendar-widget/ical-timezones` and then `@matrix-calendar-widget/calendar` before `test:all`; the final full build remains in place.
- Re-running the complete root `yarn ci` from the same worktree passed (formatting, dependency check, lint, TypeScript, workspace tests, and builds).
- No application behavior or package publication target changed.

The hosted Widget workflow already builds the timezone package before calendar and widget tests. This correction brings the local aggregate command into that dependency order.

## Publication

- Current-main base: `f24a4979a052b2a293144b3192eeee0cc2e17fa6`.
- Commit/head: `84215fbf55f884ff94e5a298a182a275b59f811b`.
- Remote ref: `origin/codex/ci-prerequisite-build-order-20261003`.
- Draft PR: [#179](https://github.com/0cwa/matrix-calendar-widget/pull/179).
- Exact PR head/base verified after publication: `84215fbf55f884ff94e5a298a182a275b59f811b` / `f24a4979a052b2a293144b3192eeee0cc2e17fa6`.
- Repository commit hooks passed dependency checks, formatting, and translation dry-run.
- Hosted checks were pending at handoff; no hosted pass is claimed.
