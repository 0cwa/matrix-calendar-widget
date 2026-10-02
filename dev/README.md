# Local integration services

This stack exercises the two external systems the calendar gateway is designed around:

- **Synapse v1.161.0** on `http://localhost:8008`
- **Radicale 3.8.0.0** with the project-owned OpenID-only auth module on `http://localhost:5232`

Radicale is built locally from `radicale-auth/Dockerfile`, based on the official Radicale 3.8.0 image pinned by digest. The module validates tagged Matrix OpenID credentials against the configured homeserver. It rejects untagged passwords before making a homeserver request.

## Start

```bash
bash dev/up.sh
```

On first run the script uses Synapse's supported `generate` command to create a homeserver configuration and signing key in a Docker volume. It then creates a local admin user if needed.

The local Synapse fixture uses a development-only account to mint a short-lived OpenID proof:

- Matrix ID: `@calendar:localhost`
- Synapse fixture password: `calendar-dev-password`
- Radicale username: `calendar`

Override them for local testing:

```bash
MATRIX_CALENDAR_DEV_USER=alice \
MATRIX_CALENDAR_DEV_PASSWORD=another-dev-password \
bash dev/up.sh
```

The fixture password is used only by `dev/mint-openid-credential.mjs` to sign in to the isolated Synapse service and request a short-lived OpenID proof. It is never sent to Radicale or the calendar gateway. `dev/up.sh` does not print either the fixture password or the proof. Radicale Basic Auth uses the Matrix **localpart** (`calendar`) and the tagged OpenID proof as its password field.

The stack also registers the synthetic `_matrix_calendar_service` application-service user from `dev/appservice-calendar-contract.yaml`. Its static tokens are test fixtures only; they are not production credentials. The room-principal contract uses the application-service token to request a short-lived proof for that user, then accesses only collections named by the test's explicit room bindings. Room access remains disabled by default in gateway configuration.

## Stop or reset

```bash
docker compose -f dev/compose.yaml down
docker compose -f dev/compose.yaml down -v --remove-orphans
```

Reset removes the named Docker volumes and all local Matrix/Radicale data.

## Scope

The gateway and widget are not included in this compose file. The CalDAV
contract workflow uses the same image and real Synapse fixture to test both
personal OpenID access and the gated appservice room-principal path. These
synthetic bindings and credentials are local/CI fixtures, not deployment
configuration. Run the gateway and widget separately with their documented
configuration.

The image reads `RADICALE_MATRIX_HOMESERVER_URL` and
`RADICALE_MATRIX_SERVER_NAME` as operator configuration. Keep the endpoint URL
and Matrix server name separate; for this stack they are `http://synapse:8008`
and `localhost`. The image keeps the Radicale collection root at
`/data/collections` with `owner_only` rights. It does not implement etke's
`RADICALE_CONFIG_*` environment translation or claim compatibility with an
etke-managed host. Confirm custom-image override and existing `/data` volume
preservation in an operator rehearsal before rollout.

Chart dev values use non-routable `.invalid` Matrix and Element hostnames as
placeholders. Replace them with operator-owned endpoints before rendering or
deploying those values; the defaults are not a working deployment profile.
The values also set the server's widget URL to
`https://matrix-calendar-widget.example.invalid` and derive widget homeserver
and API hostnames from `settings.hostname: matrix.example.invalid`; override
these values too when configuring a deployment.

When ingress is enabled, the example `settings.widgetUrl` hostname
`matrix-calendar-widget.example.invalid` is intentionally a placeholder rather
than the umbrella ingress host `matrix-calendar-widget.<settings.hostname>`,
so set it to the matching public ingress URL or to an intentional
operator-managed alias serving the widget.
