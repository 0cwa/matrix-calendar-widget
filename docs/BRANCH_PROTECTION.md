# Main branch protection

M0 leaves one repository-admin action that the connected GitHub integration cannot perform because it does not have Administration write permission.

Configure a branch rule or repository ruleset targeting `main` with these settings after PR #24 is merged.

## Required pull-request behavior

- Require a pull request before merging.
- Require conversation resolution before merging.
- Do not allow force pushes.
- Do not allow branch deletion.
- Apply the rule to administrators as well if you want the repository owner to use the same workflow as agents.

For a single-maintainer repository, requiring zero approving reviews is acceptable initially; increase this when additional maintainers join.

## Required checks

Require these stable job names:

- `Quality`
- `Widget`
- `Server and bot`
- `Analyze JavaScript/TypeScript`

The first three come from `.github/workflows/ci.yml`; the final check is CodeQL.

Prefer strict/up-to-date required checks once the project has multiple concurrent feature branches. A loose rule is acceptable during the early pre-alpha phase if strict rebases create excessive CI churn.

## Why these checks

`Quality` covers formatting, fork-identity guardrails, Compose validation, dependency checks, and TypeScript checking.

`Widget` covers the shared calendar package plus widget lint, translations, unit tests, and build.

`Server and bot` covers the gateway/bot lint, translations, tests, and build.

`Analyze JavaScript/TypeScript` provides CodeQL scanning.

## Verification

After enabling the rule:

1. open a trivial documentation PR,
2. confirm GitHub blocks merging while any required check is pending,
3. confirm merging becomes available only after all required checks pass,
4. confirm direct force-push/deletion of `main` is blocked according to the configured rule.
