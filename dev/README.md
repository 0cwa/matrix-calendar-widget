# Local integration services

This stack exercises the two external systems the calendar gateway is designed around:

- **Synapse v1.161.0** on `http://localhost:8008`
- **Radicale 3.8.0.0** with `radicale-auth-matrix` on `http://localhost:5232`

Radicale is provided by `ghcr.io/etkecc/radicale`, the wrapper that includes the Matrix authentication plugin.

## Start

```bash
bash dev/up.sh
```

On first run the script uses Synapse's supported `generate` command to create a homeserver configuration and signing key in a Docker volume. It then creates a local admin user if needed.

Default **development-only** credentials:

- Matrix ID: `@calendar:localhost`
- Matrix / CalDAV password: `calendar-dev-password`
- Radicale username: `calendar`

Override them for local testing:

```bash
MATRIX_CALENDAR_DEV_USER=alice \
MATRIX_CALENDAR_DEV_PASSWORD=another-dev-password \
bash dev/up.sh
```

The Radicale plugin expects the Matrix **localpart** as the CalDAV username, which is why the default Radicale login is `calendar`, not `@calendar:localhost`.

## Stop or reset

```bash
docker compose -f dev/compose.yaml down
docker compose -f dev/compose.yaml down -v --remove-orphans
```

Reset removes the named Docker volumes and all local Matrix/Radicale data.

## Scope

The gateway and widget are not included in this compose file yet because M2 will define their final authentication/API configuration. The services here are the stable external integration targets for contract tests and manual development.
