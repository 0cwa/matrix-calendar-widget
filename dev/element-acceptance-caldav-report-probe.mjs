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
const { projectCalendarEventOccurrences } = requireServer(
  '@matrix-calendar-widget/calendar',
);
const { getVTimezoneBlock } = requireServer(
  '@matrix-calendar-widget/ical-timezones',
);
const ICAL = requireServer('ical.js');
const { hasUnsupportedTimezoneRules } = requireServer(
  './lib/src/caldav/ICalendarTimezoneProjectionSafety.js',
);

const TIMEZONE_AUDIT_UID = 'element-acceptance-timezone-audit';

const PROJECTION_DIAGNOSTIC_REASONS = [
  'invalid-recurrence',
  'invalid-timing',
  'occurrence-limit',
  'recurrence-input-limit',
  'unsupported-recurrence',
  'unsupported-timezone',
  'range-this-and-future',
];

function emptyProjectionDiagnosticCounts() {
  return Object.fromEntries(
    PROJECTION_DIAGNOSTIC_REASONS.map((reason) => [reason, 0]),
  );
}

function unavailableProjection() {
  return {
    completed: false,
    includesCreatedEvent: null,
    diagnosticCode: 'inconclusive',
    diagnosticCounts: emptyProjectionDiagnosticCounts(),
    timezoneAudit: unavailableTimezoneAudit(),
  };
}

function unavailableTimezoneAudit() {
  return {
    completed: false,
    parsedEventUnsupportedTimezone: null,
    bundledZoneId: null,
    embeddedDefinitionCount: 0,
    canonicalEmbeddedDefinitionMatches: null,
    classification: 'inconclusive',
  };
}

function inspectCreatedEventTimezone(resource, event) {
  try {
    const timing = event.timing;
    const startZone =
      timing.type === 'timed' && timing.start.type === 'zoned'
        ? timing.start.timezone
        : undefined;
    if (!startZone) {
      const parsedEventUnsupportedTimezone = event.unsupportedTimezone === true;
      return {
        completed: true,
        parsedEventUnsupportedTimezone,
        bundledZoneId: null,
        embeddedDefinitionCount: 0,
        canonicalEmbeddedDefinitionMatches: null,
        classification: parsedEventUnsupportedTimezone
          ? 'other-unsupported-timezone'
          : 'no-zoned-start',
      };
    }

    const calendar = ICAL.Component.fromString(resource.icalendar);
    const bundledZoneId = Boolean(getVTimezoneBlock(startZone));
    const embeddedDefinitionCount = Math.min(
      calendar
        .getAllSubcomponents('vtimezone')
        .filter(
          (definition) =>
            definition.getFirstPropertyValue('tzid') === startZone,
        ).length,
      2,
    );
    const parsedEventUnsupportedTimezone = event.unsupportedTimezone === true;
    const matchingDefinitions = calendar
      .getAllSubcomponents('vtimezone')
      .filter(
        (definition) => definition.getFirstPropertyValue('tzid') === startZone,
      );
    const canonicalEmbeddedDefinitionMatches =
      bundledZoneId && embeddedDefinitionCount === 1
        ? matchesBundledDefinition(matchingDefinitions[0], startZone)
        : null;
    if (
      (!bundledZoneId ||
        embeddedDefinitionCount > 1 ||
        canonicalEmbeddedDefinitionMatches === false) &&
      !parsedEventUnsupportedTimezone
    ) {
      return unavailableTimezoneAudit();
    }
    let classification;
    if (!bundledZoneId) {
      classification = 'unsupported-zone-id';
    } else if (embeddedDefinitionCount > 1) {
      classification = 'duplicate-definitions';
    } else if (canonicalEmbeddedDefinitionMatches === false) {
      classification = 'embedded-definition-mismatch';
    } else if (parsedEventUnsupportedTimezone) {
      classification = 'other-unsupported-timezone';
    } else if (embeddedDefinitionCount === 0) {
      classification = 'no-embedded-definition';
    } else {
      classification = 'embedded-definition-matches';
    }

    return {
      completed: true,
      parsedEventUnsupportedTimezone,
      bundledZoneId,
      embeddedDefinitionCount,
      canonicalEmbeddedDefinitionMatches,
      classification,
    };
  } catch {
    return unavailableTimezoneAudit();
  }
}

function matchesBundledDefinition(definition, timezoneId) {
  try {
    const auditCalendar = ICAL.Component.fromString(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Matrix Calendar Widget//Timezone Audit//EN',
        definition.toString(),
        'BEGIN:VEVENT',
        `UID:${TIMEZONE_AUDIT_UID}`,
        `DTSTART;TZID=${timezoneId}:20260101T120000`,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );
    return !hasUnsupportedTimezoneRules(auditCalendar, TIMEZONE_AUDIT_UID);
  } catch {
    return false;
  }
}

const unavailable = (openIdStatus = null, reportStatus = null) => ({
  completed: false,
  openIdStatus,
  reportStatus,
  containsCreatedEvent: null,
  projection: unavailableProjection(),
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
    typeof input.range.timezone !== 'string' ||
    !input.range.timezone ||
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
    const parsedResources = [];
    for (const resource of resources) {
      try {
        const event = codec.parse(
          collectionUrl.href,
          resource.href,
          resource.icalendar,
        );
        parsedResources.push({ resource, parsed: event, event: event.event });
        if (event.event.uid === input.eventUid) {
          containsCreatedEvent = true;
        }
      } catch {
        writeResult(unavailable(openIdStatus, reportStatus));
        return;
      }
    }

    const rangeUnsupportedResources = parsedResources.filter(
      ({ event }) => event.unsupportedRecurrence === 'range-this-and-future',
    );
    const projectionUnsupportedResources = parsedResources.filter(
      ({ parsed }) => parsed.listProjectionDiagnostic !== undefined,
    );
    const projectableResources = parsedResources.filter(
      ({ event, parsed }) =>
        event.unsupportedRecurrence !== 'range-this-and-future' &&
        parsed.listProjectionDiagnostic === undefined,
    );
    const projection = projectCalendarEventOccurrences(
      projectableResources.map(({ event }) => event),
      { start: input.range.start, end: input.range.end },
      input.range.timezone,
    );
    const inRangeResourceIds = new Set(
      projection.occurrences.map(({ sourceEvent }) => sourceEvent.id),
    );
    const diagnosticCounts = emptyProjectionDiagnosticCounts();
    if (rangeUnsupportedResources.length > 0) {
      diagnosticCounts['range-this-and-future'] = Math.min(
        rangeUnsupportedResources.length,
        2,
      );
    }
    if (projectionUnsupportedResources.length > 0) {
      diagnosticCounts['unsupported-recurrence'] = Math.min(
        projectionUnsupportedResources.length,
        2,
      );
    }
    for (const diagnostic of projection.diagnostics) {
      diagnosticCounts[diagnostic.reason] = Math.min(
        diagnosticCounts[diagnostic.reason] + 1,
        2,
      );
    }
    const created = parsedResources.find(
      ({ event }) => event.uid === input.eventUid,
    );
    let diagnosticCode = 'none';
    let includesCreatedEvent = false;
    if (created) {
      includesCreatedEvent = inRangeResourceIds.has(created.event.id);
      diagnosticCode = 'none';
      if (created.event.unsupportedRecurrence === 'range-this-and-future') {
        diagnosticCode = 'range-this-and-future';
      } else if (created.parsed.listProjectionDiagnostic !== undefined) {
        diagnosticCode = 'unsupported-recurrence';
      } else {
        diagnosticCode =
          projection.diagnostics.find(
            ({ sourceEvent }) => sourceEvent.id === created.event.id,
          )?.reason ?? 'none';
      }
    }

    writeResult({
      completed: true,
      openIdStatus,
      reportStatus,
      containsCreatedEvent,
      projection: {
        completed: true,
        includesCreatedEvent,
        diagnosticCode,
        diagnosticCounts,
        timezoneAudit: created
          ? inspectCreatedEventTimezone(created.resource, created.event)
          : unavailableTimezoneAudit(),
      },
    });
  } catch {
    writeResult(unavailable(openIdStatus, reportStatus));
  }
}

void main().catch(() => writeResult(unavailable()));
