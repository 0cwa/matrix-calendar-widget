# Private calendar app access validation

This is branch-specific development evidence, not a release qualification.
It records checks run against source commit
`867ef236d74da6b24e0b9974d533c6b0f5fca386` on 21 October 2026. Results are
local; they are not CI results or deployment evidence. The private-client
feature remains default-off.

## Local type and build checks

The following commands passed with Node 26 in the integrated private-client
checkout:

| Working directory        | Command                                                                         | Result                                                 |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Repository root          | `node_modules/.bin/tsc --project packages/ical-timezones/tsconfig.json`         | Passed                                                 |
| Repository root          | `node_modules/.bin/tsc --project packages/calendar/tsconfig.json`               | Passed                                                 |
| Repository root          | `node_modules/.bin/tsc --noEmit --project matrix-calendar-widget/tsconfig.json` | Passed                                                 |
| Repository root          | `node_modules/.bin/tsc --noEmit --project matrix-calendar-server/tsconfig.json` | Passed                                                 |
| `matrix-calendar-server` | `../node_modules/.bin/nest build`                                               | Passed                                                 |
| `matrix-calendar-widget` | `../node_modules/.bin/vite build`                                               | Passed; Vite reported its existing large-chunk warning |

## Focused behavior checks

| Working directory        | Command                                                                                                                                                                                                                                                                                                                                                                                                  | Result                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `matrix-calendar-widget` | `../node_modules/.bin/vitest run src/calendar/GatewayCalendarRepository.test.ts src/calendar/GatewayCalendarTransport.test.ts src/components/calendar/CalendarPrivateClientDialog.test.tsx src/components/calendar/CalendarToolbar.test.tsx --maxWorkers=2`                                                                                                                                              | 4 files, 54 tests passed                                                                                                                 |
| `matrix-calendar-server` | `../node_modules/.bin/jest --runInBand src/configuration.test.ts src/service/private-client/PrivateCalendarClientPolicy.test.ts src/service/private-client/PrivateCalendarClientService.test.ts src/service/private-client/PrivateCalendarClientPath.test.ts src/service/private-client/PrivateCalendarClientCallbackGateway.test.ts src/service/private-client/PrivateCalendarClientDavGateway.test.ts` | 5 suites, 73 tests passed; the DAV suite could not bind loopback in the sandbox                                                          |
| `matrix-calendar-server` | `../node_modules/.bin/jest --runInBand src/service/private-client/PrivateCalendarClientDavGateway.test.ts`                                                                                                                                                                                                                                                                                               | 1 suite, 14 tests passed with host loopback permission                                                                                   |
| `matrix-calendar-server` | `PRIVATE_CALDAV_CONTRACT=1 ../node_modules/.bin/jest --runInBand test/integration/PrivateCalendarClientRadicaleContract.test.ts --forceExit`                                                                                                                                                                                                                                                             | 1 integration test passed against Radicale 3.8 and python-caldav 3.5.0, using synthetic Matrix identities and isolated temporary storage |
| `radicale-auth`          | `PYTHONPATH=radicale-auth/src /tmp/mcw-public-feeds-radicale-venv/bin/python radicale-auth/tests/public_feed_contract.py`                                                                                                                                                                                                                                                                                | Passed against Radicale 3.8 with native map and token sharing enabled and composite private-client rights loaded                         |

The combined public-feed contract covers anonymous read-only token GET/HEAD
and PROPFIND, token administration denial without owner authentication,
restart persistence, revocation, VEVENT filtering, appservice-owner sharing,
and token-path redaction. Its synthetic identities are not a real Matrix
homeserver integration. The private Radicale integration covers standard
CalDAV discovery and conditional create/update/delete, stale ETag rejection,
unknown VEVENT property preservation, unsupported-resource protection,
and current-policy denial through the gateway. Across the backend unit-test runs, all 87 focused tests passed; the loopback suite required a separate host-permission run because the sandbox denied socket binding.

## Opt-in Element Web private-client acceptance source

The acceptance branch adds a manual-only `private_ui` workflow input whose
default is false. When enabled, the appservice acceptance run uses the existing
single gateway and canonical Radicale fixture with public and private features
enabled together; the public-feed signing key, private epoch key, and callback
key are generated independently. Normal pull-request and bot-account
acceptance continue with the input disabled.

The browser reaches both the private-client UI API and raw CalDAV through an
acceptance-only TLS bridge at `https://127.0.0.1:3001`. The bridge publishes
only on host loopback, forwards to the existing `gateway:3000`, and joins only
the internal callback network shared with the gateway and Radicale. It adds no
Matrix, credential, policy, or CalDAV business logic. Gateway auth remains
authoritative: Matrix OpenID and room policy protect the UI API, and the
gateway authenticates private DAV credentials before forwarding DAV requests
to Radicale. Radicale calls the gateway callback through the same bridge using
the fixed callback paths and an HMAC key. The test certificate SANs cover the
browser IP and callback service DNS name. Chromium pins the ephemeral leaf
SPKI, the existing member/outsider Playwright command receives the temporary
CA through `NODE_EXTRA_CA_CERTS` only for its Node-side anonymous public-feed
requests, the direct DAV client uses that CA explicitly, and Radicale reads the
mounted public CA file. No host trust store is changed.

The new Element Web flow uses three separate synthetic Matrix sessions. It
creates credentials in the real dialog, checks the one-time reveal and later
listing, verifies that credentials are absent from browser storage, and
confirms no public-feed mutation request accompanies private credential
creation. It then performs real DAV principal and collection discovery, VEVENT
create/read/update/read, checks a same-room non-manager and a non-member
outsider are denied, revokes access in the UI, and verifies the same DAV
credential receives an empty `401` response afterward. The test keeps
credentials, private URLs, and ICS bodies in memory; assertions observe only
status values and booleans. Playwright trace, video, and screenshots are
disabled for this flow, and its temporary output log is mode `0600` and removed
during cleanup.

This new browser flow and its trust/network preparation tests have not yet been
run locally or in the hosted workflow. It is test-profile TLS evidence only;
it does not qualify public TLS, desktop/native clients, deployment, or host
trust. The prior backend and Radicale checks above remain tied to their
recorded source commit and do not prove this new UI path.

## Documentation checks

After updating the branch status and guide, these commands passed:

| Working directory | Command                                   | Result                                          |
| ----------------- | ----------------------------------------- | ----------------------------------------------- |
| Repository root   | `node scripts/check-docs.mjs`             | Checked 101 Markdown files and 1010 local links |
| Repository root   | `node --test scripts/check-docs.test.mjs` | 1 test passed                                   |

## Remaining acceptance gates

- Verify private-store migration coexistence with reminder v4 and room-binding
  migrations in both application orders, reconnect, and restore before enabling
  the feature.
- Qualify at least one actual desktop CalDAV application using a dedicated
  test profile.
- Exercise the gateway against a real Matrix homeserver and room policy.
- Run required CI checks on the release Node version and obtain the combined
  source review. No deployment or production write was performed.

## Issue #406: native revocation proof boundary

The next native-client qualification records client feedback separately from
server enforcement. A rejected Thunderbird provider operation is client
feedback; a fulfilled operation or missing callback is not evidence that the
client received a revocation error. The fixture can independently prove server
enforcement only when the actual discovered Thunderbird provider loads a fresh,
owner-seeded event before revocation, makes no earlier write to that event, and
then issues the one explicit edit after the tombstone is committed. The
fixture-only receipt binds that request to the exact private credential and
resource, records the revoked policy decision and 401/403 response, and
confirms an owner read still matches the canonical pre-revocation bytes and
opaque property. It does not log or retain the request body.

That server-side result proves the revoked credential could not change the
canonical object. It does not claim Thunderbird reported the denial to the
user. Missing or ambiguous request correlation, a non-denial response, or a
changed canonical object remains a failed qualification. This issue follow-up
has not passed the actual hosted Thunderbird fixture and does not change the
default-off release status.
