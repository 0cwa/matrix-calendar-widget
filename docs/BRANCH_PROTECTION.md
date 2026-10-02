# Main branch protection

GitHub's current protection settings for `main` are configured as described
below and were confirmed through the repository API on 2026-10-02. Issue #29
records a trivial documentation-PR check for verifying that GitHub blocks
merging while a required check is pending and allows merging only after all
five required checks pass.

The configured branch rule or repository ruleset targeting `main` has these
settings.

## Required pull-request behavior

- Require a pull request before merging.
- Require conversation resolution before merging.
- Do not allow force pushes.
- Do not allow branch deletion.
- Enforce the rule for administrators; administrator enforcement is enabled on `main`.

For a single-maintainer repository, requiring zero approving reviews is acceptable initially; increase this when additional maintainers join.

## Required checks

Require these five stable job names:

- `Quality`
- `Widget`
- `Server and bot`
- `Container image build smoke`
- `Analyze JavaScript/TypeScript`

The first four come from `.github/workflows/ci.yml`; `Analyze JavaScript/TypeScript` comes from `.github/workflows/codeql.yml`.

Keep `Real Radicale contract` non-required for now. Its workflow uses pull-request path filters, so unrelated pull requests can skip the workflow without a deterministic successful skipped-path check. Reconsider this only after skipped paths report a stable result that satisfies branch protection.

Prefer strict/up-to-date required checks once the project has multiple concurrent feature branches. A loose rule is acceptable during the early pre-alpha phase if strict rebases create excessive CI churn.

## Why these checks

`Quality` covers formatting, fork-identity guardrails, Compose validation, dependency checks, and TypeScript checking.

`Widget` covers the shared calendar package plus widget lint, translations, unit tests, and build.

`Server and bot` covers the gateway/bot lint, translations, tests, and build.

`Container image build smoke` builds both workspace images locally in CI without publishing them.

`Analyze JavaScript/TypeScript` provides CodeQL scanning.

## Verification

To verify the configured rule's behavior:

1. open a trivial documentation PR,
2. while any required check is pending, inspect the PR's merge state in GitHub
   and confirm merging is blocked,
3. after all five required checks pass, inspect the merge state again and
   confirm merging is available,
4. confirm direct force-push/deletion of `main` is blocked according to the configured rule.
