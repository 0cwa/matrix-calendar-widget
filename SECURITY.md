# Security policy

## Project status

Matrix Calendar Widget is currently pre-alpha and does not yet have a supported production release.

## Reporting a vulnerability

Please do **not** publish vulnerability details in a normal GitHub issue.

Use GitHub's private vulnerability reporting / Security Advisory flow for this repository when available. Include:

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
- complete private ICS files,
- private room IDs or event content unless necessary and sanitized.

## Supported versions

No production version is currently supported. This section will be updated before the first beta release.
