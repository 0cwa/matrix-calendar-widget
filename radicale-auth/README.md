# Project-owned Radicale OpenID authentication

[Project overview](../README.md) · [Architecture](../docs/ARCHITECTURE.md) · [Deployment](../docs/deployment-docker.md)

This directory builds the project's Radicale 3.8.0.0 image and contains its
clean-room `Auth` plugin. The image extends the official Radicale image pinned
by digest in `Dockerfile`. The build preserves the base image's installed
py-vobject package and version, then applies only the PERIOD serializer change
from upstream commit `952210e1d1c3a6f17dac1c29c3be24bf3be9bc3f`. The patch
requires the expected upstream serializer source shape and fails the image
build if that shape changes. The plugin uses only Python's standard library
and Radicale's supported authentication interface.

Radicale Basic Auth uses the Matrix localpart as the username and this tagged
password format:

```text
matrix-openid:<unpadded-base64url(JSON)>
```

The JSON object must contain exactly `access_token` and `matrix_server_name`.
The adapter sends the proof to the configured homeserver's fixed
`/_matrix/federation/v1/openid/userinfo` endpoint, with redirects and proxy
settings disabled. It accepts the proof only when the returned Matrix subject
has the same localpart and configured server name. Untagged credentials fail
before network access. The plugin disables Radicale's authentication cache so
each proof is checked on each request. It does not call the Matrix password
login API.

Configure `RADICALE_MATRIX_HOMESERVER_URL` and
`RADICALE_MATRIX_SERVER_NAME` on the Radicale container. The bundled config
uses `owner_only` rights and stores collections under `/data/collections`.
The image keeps Radicale's existing `/data` mount point. Compatibility with an
etke-managed image override, service environment translation, and existing
host data ownership is not verified by this package.

Native read-only token sharing is configured for optional
[public calendar feeds](../docs/adrs/adr045-public-calendar-feeds.md). Sharing
keeps `owner_only` rights unchanged and stores tokens under the persistent
`/data` tree. Public clients access the gateway, not Radicale's `/.token/` or
`/.sharing/` routes. The auth package also redacts native token paths from
Radicale logs. Back up the full store with the gateway's matching signing key.

Run the focused tests from the repository root with the pinned official
Radicale package installed:

```bash
PYTHONPATH=radicale-auth/src python -m unittest discover -s radicale-auth/tests -v
```

For a reproducible environment, build the test image from the repository root:

```bash
docker build --target test -t matrix-calendar-widget/radicale-openid:test radicale-auth
```

The CI image smoke builds both the `test` and `runtime` targets. The image test
target checks Radicale's PERIOD capability and round-trips explicit-end and
duration PERIOD values with a TZID. The isolated
development and CalDAV contract stacks build this Dockerfile and obtain their
short-lived proof from the Synapse fixture.
