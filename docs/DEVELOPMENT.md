# Development guide

## Toolchain

- Node.js: >=22.12.0 for the full-workspace development install and test toolchain. The server production runtime minimum remains `>=20`.
- Package manager: Yarn 1.22.x.
- TypeScript monorepo using Yarn workspaces.
- Widget: React + Vite + Matrix Widget Toolkit + MUI + FullCalendar.
- Server/bot: inherited NestJS service, to become the calendar gateway + bot.

Do not migrate package managers or build systems as part of unrelated feature work.

## Setup

```bash
corepack enable
yarn install --frozen-lockfile
```

## Common commands

```bash
yarn dev              # inherited widget dev server
yarn build            # build workspaces
yarn tsc              # type-check workspaces
yarn lint             # lint workspaces
yarn test:all         # non-interactive test suites
yarn prettier:check   # formatting check
yarn ci               # canonical local CI gate
```

## Fast feedback versus release qualification

This project has two deliberate feedback loops, plus a separate release gate:

- **During implementation**, run the smallest relevant workspace tests, TypeScript checks, lints and recurrence/ICS fixtures first. For example, use `yarn workspace @matrix-calendar-widget/widget test:all` for widget work or `yarn workspace @matrix-calendar-widget/server test:all` for gateway work; run full checks before claiming a PR is ready. A fast smoke profile proposed in [#256](https://github.com/0cwa/matrix-calendar-widget/issues/256) is _not yet_ a new canonical command.
- **For pull requests**, keep all five existing protected CI contexts and the integration tests applicable to the changed boundaries; do not infer auth, CalDAV or rendering correctness from mock-only tests.
- **For a release candidate**, use the frozen-SHA evidence and operator gates in [RELEASE.md](./RELEASE.md) and [beta-scope.md](./beta-scope.md), including full approved Element Web/Desktop, image and restore rehearsals. Passing CI or the hosted synthetic suite alone is not deployment authorization.

The distinction is speed of everyday feedback, not weaker correctness. Record the first actionable failure, harness/setup-only failures and changed-module radius before/after #256–#258. Refactor the harness only when it becomes measurably easier to operate and retains egress, sanitization and cleanup guarantees.

See [ROADMAP.md](./ROADMAP.md) and [roadmap issue #273](https://github.com/0cwa/matrix-calendar-widget/issues/273) before selecting work. While #255/#251 are active, avoid broad inherited-code removal or dependency upgrades on the frozen pilot candidate.

## Agent workflow

1. Read `AGENTS.md` and the relevant ADRs.
2. Pick a checked/unchecked item from `docs/PLAN.md` or a GitHub issue.
3. Create a narrowly named branch.
4. Make the smallest vertical change that demonstrates the behavior.
5. Add tests and fixtures.
6. Run `yarn ci`.
7. Update plan/docs when the completed behavior changes project state.
8. Open a PR explaining scope, testing, data-model impact, and follow-ups.

## Calendar fixtures

The project will maintain fixtures covering:

- simple timed VEVENT,
- all-day event,
- timezone/DST boundary,
- RRULE,
- EXDATE/RDATE,
- recurrence override,
- VALARM,
- organizer/attendees,
- unknown `X-*` properties,
- mixed collection behavior.

Any bug caused by an ICS sample should add a minimized regression fixture.

## Integration environment

A pinned Synapse + Matrix-authenticated Radicale stack lives in [dev/](../dev/README.md).

```bash
yarn dev:services:up
```

This provides the stable external integration targets now.

This is a development/contract test stack, not evidence of compatibility with an operator's actual target. Follow [beta scope](./beta-scope.md) and the [release gate](./RELEASE.md) for pilot certification.

## Code review expectations

PRs should answer:

- What user capability changed?
- Which source-of-truth boundary is touched?
- How is authorization enforced?
- What happens to unknown iCalendar data?
- What tests protect recurrence/timezone behavior if relevant?
- Does the change add or alter an architectural decision?
