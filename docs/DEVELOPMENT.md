# Development guide

## Toolchain

- Node.js: 22 recommended; inherited packages currently declare `>=20`.
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

M0 will add a reproducible development stack containing at least:

- Matrix homeserver,
- Radicale,
- the calendar gateway/bot,
- the widget,
- optionally an Element Web instance or test harness.

Until that stack lands, use inherited widget/bot development instructions where applicable.

## Code review expectations

PRs should answer:

- What user capability changed?
- Which source-of-truth boundary is touched?
- How is authorization enforced?
- What happens to unknown iCalendar data?
- What tests protect recurrence/timezone behavior if relevant?
- Does the change add or alter an architectural decision?
