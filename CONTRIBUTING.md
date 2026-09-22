# Contributing

Thanks for helping build Matrix Calendar Widget.

Start with [AGENTS.md](./AGENTS.md). It contains the same architectural guardrails expected of both human and automated contributors.

## Before coding

1. Read `docs/PLAN.md` and relevant ADRs.
2. Prefer an existing GitHub issue; otherwise create a narrowly scoped implementation task.
3. Keep changes vertical and reviewable.
4. Do not combine broad inherited-code cleanup with a feature unless required.

## Local quality gate

```bash
corepack enable
yarn install --frozen-lockfile
yarn ci
```

## Pull requests

A PR should include:

- the user/system outcome,
- tests,
- security/authorization impact,
- iCalendar round-trip impact where applicable,
- screenshots for widget UI changes,
- an ADR when an architecture boundary changes.

The repository is a derivative of an Apache-2.0 project. Preserve required upstream copyright and NOTICE information in inherited code.
