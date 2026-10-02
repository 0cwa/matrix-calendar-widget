# Project-owned Radicale OpenID authentication

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

Run the focused tests with the official Radicale package installed:

```bash
PYTHONPATH=src python -m unittest discover -s tests -v
```

The CI image smoke builds both the `test` and `runtime` targets. The image test
target checks Radicale's PERIOD capability and round-trips explicit-end and
duration PERIOD values with a TZID. The isolated
development and CalDAV contract stacks build this Dockerfile and obtain their
short-lived proof from the Synapse fixture.
