# Security policy

[Project overview](./README.md) · [Documentation](./docs/README.md) · [Threat model](./docs/threat-model.md)

## Project status

Matrix Calendar Widget is currently pre-alpha and does not yet have a supported production release.

## Reporting a vulnerability

Please do **not** publish vulnerability details in a normal GitHub issue.

Use this repository's [private vulnerability reporting / Security Advisory flow](https://github.com/0cwa/matrix-calendar-widget/security/advisories/new) when available. Include:

- a concise description,
- affected commit/version,
- reproduction steps or proof of concept,
- expected impact,
- suggested mitigation if known.

If private reporting is unavailable, open a public issue containing **no vulnerability details** and ask the maintainer for a private reporting channel.

## Sensitive data

Calendar data can contain titles, attendee identities, locations, availability information, meeting URLs, and descriptions. Treat it as sensitive.

Never include these in public reports:

- Matrix access tokens,
- Matrix OpenID assertions,
- passwords,
- CalDAV Authorization headers,
- gateway session secrets,
- public-calendar subscription URLs, native sharing tokens, or signing keys,
- database connection strings or secret-bearing backup/configuration files,
- complete private ICS files,
- private room IDs or event content unless necessary and sanitized.

See the [security threat model](./docs/threat-model.md) for the current
gateway trust boundaries, implementation evidence, and unresolved risks. The
document describes repository code and does not verify an operator-hosted
deployment.

## Supported versions

No production version is currently supported. This section will be updated before the first beta release.
