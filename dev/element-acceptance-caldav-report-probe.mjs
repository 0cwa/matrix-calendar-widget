import { createRequire } from 'node:module';

const SERVICE_USER_ID = '@_matrix_calendar_service:localhost';
const SERVICE_LOCALPART = '_matrix_calendar_service';
const CALENDAR_ID = 'element-acceptance';
const HOMESERVER_URL = 'http://127.0.0.1:8008';
const RADICALE_URL = 'http://127.0.0.1:5232/';
const requireServer = createRequire(
  new URL('../matrix-calendar-server/package.json', import.meta.url),
);
const { CalDavEventClient } = requireServer(
  './lib/src/caldav/CalDavEventClient.js',
);
const { ICalendarEventCodec } = requireServer(
  './lib/src/caldav/ICalendarEventCodec.js',
);

const unavailable = (openIdStatus = null, reportStatus = null) => ({
  completed: false,
  openIdStatus,
  reportStatus,
  containsCreatedEvent: null,
});

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function readInput() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 16_384) return undefined;
  }
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

async function main() {
  const input = await readInput();
  const applicationServiceToken = process.env.MATRIX_APPLICATION_SERVICE_TOKEN;
  if (
    !input ||
    input.calendarId !== CALENDAR_ID ||
    typeof input.eventUid !== 'string' ||
    input.eventUid.length === 0 ||
    !input.range ||
    typeof input.range.start !== 'string' ||
    typeof input.range.end !== 'string' ||
    !Number.isFinite(Date.parse(input.range.start)) ||
    !Number.isFinite(Date.parse(input.range.end)) ||
    Date.parse(input.range.end) <= Date.parse(input.range.start) ||
    typeof applicationServiceToken !== 'string' ||
    applicationServiceToken.length === 0
  ) {
    writeResult(unavailable());
    return;
  }

  let openIdStatus = null;
  let reportStatus = null;
  try {
    const openIdUrl = new URL(
      `/_matrix/client/v3/user/${encodeURIComponent(SERVICE_USER_ID)}/openid/request_token`,
      HOMESERVER_URL,
    );
    const openIdResponse = await fetch(openIdUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${applicationServiceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: SERVICE_USER_ID }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    openIdStatus = openIdResponse.status;
    if (!openIdResponse.ok) {
      await openIdResponse.body?.cancel().catch(() => undefined);
      writeResult(unavailable(openIdStatus));
      return;
    }

    let credential;
    try {
      const proof = await openIdResponse.json();
      if (
        !proof ||
        typeof proof.access_token !== 'string' ||
        proof.access_token.length === 0 ||
        proof.matrix_server_name !== 'localhost'
      ) {
        writeResult(unavailable(openIdStatus));
        return;
      }
      const delegatedCredential = Buffer.from(
        JSON.stringify({
          access_token: proof.access_token,
          matrix_server_name: proof.matrix_server_name,
        }),
      ).toString('base64url');
      const authorization = Buffer.from(
        `${SERVICE_LOCALPART}:matrix-openid:${delegatedCredential}`,
        'utf8',
      ).toString('base64');
      credential = {
        getRequestHeaders: async () => ({
          Authorization: `Basic ${authorization}`,
        }),
      };
    } catch {
      writeResult(unavailable(openIdStatus));
      return;
    }

    const trackedFetch = async (url, init) => {
      const response = await fetch(url, init);
      if (init?.method === 'REPORT') reportStatus = response.status;
      return response;
    };
    const client = new CalDavEventClient(credential, trackedFetch);
    const collectionUrl = new URL(
      `${encodeURIComponent(SERVICE_LOCALPART)}/${encodeURIComponent(CALENDAR_ID)}/`,
      RADICALE_URL,
    );
    const resources = await client.listEvents(
      collectionUrl.href,
      {
        start: input.range.start,
        end: input.range.end,
      },
      AbortSignal.timeout(10_000),
    );
    const codec = new ICalendarEventCodec();
    let containsCreatedEvent = false;
    for (const resource of resources) {
      try {
        const event = codec.parse(
          CALENDAR_ID,
          'element-acceptance-probe.ics',
          resource.icalendar,
        ).event;
        if (event.uid === input.eventUid) {
          containsCreatedEvent = true;
          break;
        }
      } catch {
        writeResult(unavailable(openIdStatus, reportStatus));
        return;
      }
    }
    writeResult({
      completed: true,
      openIdStatus,
      reportStatus,
      containsCreatedEvent,
    });
  } catch {
    writeResult(unavailable(openIdStatus, reportStatus));
  }
}

void main().catch(() => writeResult(unavailable()));
