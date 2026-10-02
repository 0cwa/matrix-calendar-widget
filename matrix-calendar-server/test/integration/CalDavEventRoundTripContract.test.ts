/*
 * Copyright 2026 Matrix Calendar Widget contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fetchMock from 'jest-fetch-mock';
import { randomUUID } from 'node:crypto';
import {
  CalDavCredentialProvider,
  CalDavEventClient,
  ICalendarEventCodec,
} from '../../src/caldav';

const describeContract =
  process.env.CALDAV_CONTRACT === '1' ? describe : describe.skip;

describeContract('CalDAV VEVENT round-trip contract', () => {
  const baseUrl = process.env.CALDAV_BASE_URL ?? 'http://localhost:5232/';
  const username = process.env.CALDAV_USERNAME ?? 'calendar';
  const openIdCredential = process.env.CALDAV_OPENID_CREDENTIAL ?? '';
  const calendarUrl = new URL(
    `${encodeURIComponent(username)}/contract-calendar/`,
    baseUrl,
  ).toString();
  const eventUrl = new URL('round-trip.ics', calendarUrl).toString();
  const credentials = basicCredentialProvider(username, openIdCredential);
  const codec = new ICalendarEventCodec();
  let client: CalDavEventClient;
  let cleanupResourceUrls: string[] = [];

  beforeAll(() => {
    fetchMock.disableMocks();
    client = new CalDavEventClient(credentials);
  });

  afterEach(async () => {
    if (cleanupResourceUrls.length === 0) {
      return;
    }

    const resourceUrls = cleanupResourceUrls;
    cleanupResourceUrls = [];

    for (const resourceUrl of resourceUrls) {
      try {
        const resource = await client.getEvent(resourceUrl);
        await client.deleteEvent(resourceUrl, resource.etag);
      } catch {
        // Cleanup is best-effort and targets only this test's unique resource.
      }
    }
  });

  afterAll(() => {
    fetchMock.enableMocks();
    fetchMock.dontMock();
  });

  it('round-trips through the gateway core and a direct CalDAV client without data loss', async () => {
    const created = codec.create(calendarUrl, eventUrl, {
      uid: 'round-trip@matrix-calendar-widget',
      title: 'Created through gateway core',
      description: 'Initial description',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2030-01-15T10:00:00',
          timezone: 'UTC',
        },
        end: {
          type: 'zoned',
          local: '2030-01-15T11:00:00',
          timezone: 'UTC',
        },
      },
    });

    await client.createEvent(eventUrl, created.icalendar);

    const directRead = await directGet(eventUrl, credentials);
    expect(directRead.body).toContain('SUMMARY:Created through gateway core');

    const secondClientBody = directRead.body
      .replace(
        'SUMMARY:Created through gateway core',
        'SUMMARY:Changed by direct CalDAV',
      )
      .replace('END:VEVENT', 'X-SECOND-CLIENT:preserve-me\r\nEND:VEVENT');

    await directPut(eventUrl, directRead.etag, secondClientBody, credentials);

    const observed = await client.getEvent(eventUrl);
    expect(
      codec.parse(calendarUrl, eventUrl, observed.icalendar).event.title,
    ).toBe('Changed by direct CalDAV');

    const patched = codec
      .parse(calendarUrl, eventUrl, observed.icalendar)
      .applyPatch({ location: 'Matrix room' });

    await client.updateEvent(eventUrl, observed.etag, patched.icalendar);

    const afterGatewayWrite = await directGet(eventUrl, credentials);
    expect(afterGatewayWrite.body).toContain('LOCATION:Matrix room');
    expect(afterGatewayWrite.body).toContain('X-SECOND-CLIENT:preserve-me');

    const staleSnapshot = await client.getEvent(eventUrl);
    const directChangedAgain = staleSnapshot.icalendar.replace(
      'DESCRIPTION:Initial description',
      'DESCRIPTION:Changed by second client',
    );

    await directPut(
      eventUrl,
      staleSnapshot.etag,
      directChangedAgain,
      credentials,
    );

    const stalePatch = codec
      .parse(calendarUrl, eventUrl, staleSnapshot.icalendar)
      .applyPatch({ title: 'Stale gateway edit' });

    await expect(
      client.updateEvent(eventUrl, staleSnapshot.etag, stalePatch.icalendar),
    ).rejects.toMatchObject({
      code: 'etag-conflict',
      status: expect.any(Number),
    });
  });

  it('round-trips a recurring master and detached overrides in one CalDAV resource', async () => {
    const uid = `radicale-${randomUUID()}@matrix-calendar-widget`;
    const resourceUrl = new URL(
      `${randomUUID()}-recurrence.ics`,
      calendarUrl,
    ).toString();
    const source = recurringCalendar(uid);

    await client.createEvent(resourceUrl, source);
    cleanupResourceUrls = [resourceUrl];

    const createdResource = await client.getEvent(resourceUrl);
    expect(createdResource.href).toBe(resourceUrl);
    expect(createdResource.etag).toBeTruthy();
    expect(createdResource.icalendar.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expectRecurringResourceProperties(createdResource.icalendar, uid);

    const initial = codec.parse(
      calendarUrl,
      resourceUrl,
      createdResource.icalendar,
    );
    expect(initial.event.uid).toBe(uid);

    const patched = initial.applyPatch({ location: 'Interoperability room' });
    await client.updateEvent(
      resourceUrl,
      createdResource.etag,
      patched.icalendar,
    );

    const afterPatch = await client.getEvent(resourceUrl);
    const verified = codec.parse(
      calendarUrl,
      resourceUrl,
      afterPatch.icalendar,
    );
    expect(afterPatch.href).toBe(resourceUrl);
    expect(afterPatch.etag).toBeTruthy();
    expect(afterPatch.icalendar.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expectRecurringResourceProperties(afterPatch.icalendar, uid);
    expect(verified.event).toMatchObject({
      uid,
      location: 'Interoperability room',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-05T14:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
    });
  });

  it('removes one PERIOD RDATE from a serialized CalDAV resource with its current ETag', async () => {
    const uid = `period-remove-${randomUUID()}@matrix-calendar-widget`;
    const resourceUrl = new URL(
      `${randomUUID()}-period.ics`,
      calendarUrl,
    ).toString();
    const source = recurringCalendar(uid).replace(
      'RDATE;TZID=Europe/Stockholm:20261026T140000',
      [
        'RDATE;TZID=Europe/Stockholm:20261026T140000',
        'RDATE;VALUE=PERIOD;TZID=Europe/Stockholm;X-KEEP=end:20261027T093000/20261027T103000',
        'RDATE;VALUE=PERIOD;TZID=Europe/Stockholm;X-KEEP=duration:20261028T093000/PT1H',
      ].join('\r\n'),
    );
    cleanupResourceUrls = [resourceUrl];

    await client.createEvent(resourceUrl, source);
    const before = await client.getEvent(resourceUrl);
    const parsed = codec.parse(calendarUrl, resourceUrl, before.icalendar);
    const target = parsed.event.recurrence?.rdates?.find(
      (value) => value.type === 'period' && value.timing.type === 'duration',
    );
    expect(target?.type).toBe('period');
    if (!target || target.type !== 'period') {
      throw new Error('Expected duration-valued RDATE PERIOD');
    }
    const patched = parsed.applyPatch({
      recurrence: { rdate: { action: 'remove-period', value: target } },
    });

    await client.updateEvent(resourceUrl, before.etag, patched.icalendar);

    const after = await client.getEvent(resourceUrl);
    const verified = codec.parse(calendarUrl, resourceUrl, after.icalendar);
    expect(verified.event.recurrence?.rdates).toHaveLength(2);
    expect(after.icalendar).not.toContain('X-KEEP=duration');
    expect(after.icalendar).toContain('X-KEEP=end');
    expect(after.icalendar).toContain(
      'RDATE;TZID=Europe/Stockholm:20261026T140000',
    );
    expect(after.icalendar).toContain('BEGIN:VTIMEZONE');
    expect(after.icalendar).toContain(
      'EXDATE;TZID=Europe/Stockholm:20261102T140000',
    );
    expect(after.icalendar).toContain('RECURRENCE-ID;TZID=Europe/Stockholm');
    expect(after.icalendar).toContain(
      'X-CLIENT-METADATA;X-PARAM=preserve-param',
    );
    expect(after.icalendar).toContain('X-OVERRIDE-MARKER;X-ORIGIN=external');
  });

  it('overfetches floating and DATE boundary candidates without modifying their resources', async () => {
    const floatingUrl = new URL(
      `${randomUUID()}-floating.ics`,
      calendarUrl,
    ).toString();
    const dateUrl = new URL(`${randomUUID()}-date.ics`, calendarUrl).toString();
    cleanupResourceUrls = [floatingUrl, dateUrl];

    await client.createEvent(
      floatingUrl,
      candidateCalendar(
        `floating-${randomUUID()}@matrix-calendar-widget`,
        'DTSTART:20300115T003000',
        'DTEND:20300115T013000',
      ),
    );
    await client.createEvent(
      dateUrl,
      candidateCalendar(
        `date-${randomUUID()}@matrix-calendar-widget`,
        'DTSTART;VALUE=DATE:20300117',
        'DTEND;VALUE=DATE:20300118',
      ),
    );

    const snapshots = await Promise.all(
      cleanupResourceUrls.map((resourceUrl) => client.getEvent(resourceUrl)),
    );
    const candidates = await client.listEvents(calendarUrl, {
      start: '2030-01-15T08:00:00Z',
      end: '2030-01-16T08:00:00Z',
    });

    expect(candidates.map(({ href }) => href)).toEqual(
      expect.arrayContaining(cleanupResourceUrls),
    );

    const afterQuery = await Promise.all(
      cleanupResourceUrls.map((resourceUrl) => client.getEvent(resourceUrl)),
    );
    expect(afterQuery.map(({ etag }) => etag)).toEqual(
      snapshots.map(({ etag }) => etag),
    );
    expect(afterQuery.map(({ icalendar }) => icalendar)).toEqual(
      snapshots.map(({ icalendar }) => icalendar),
    );
  });
});

function candidateCalendar(
  uid: string,
  dtstart: string,
  dtend: string,
): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Matrix Calendar Widget//Candidate Range Contract//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260928T120000Z',
    dtstart,
    dtend,
    'SUMMARY:Candidate range boundary',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function recurringCalendar(uid: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Matrix Calendar Widget//Contract//EN',
    'X-CUSTOM-CALENDAR-PROPERTY:preserve-resource-value',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Stockholm',
    'X-LIC-LOCATION:Europe/Stockholm',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260922T120000Z',
    'DTSTART;TZID=Europe/Stockholm:20261005T140000',
    'DTEND;TZID=Europe/Stockholm:20261005T150000',
    'SUMMARY:Weekly review',
    'RRULE:FREQ=WEEKLY;COUNT=4',
    'RDATE;TZID=Europe/Stockholm:20261026T140000',
    'EXDATE;TZID=Europe/Stockholm:20261102T140000',
    'X-CLIENT-METADATA;X-PARAM=preserve-param:preserve-value',
    'END:VEVENT',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260922T120000Z',
    'RECURRENCE-ID;TZID=Europe/Stockholm:20261012T140000',
    'DTSTART;TZID=Europe/Stockholm:20261012T160000',
    'DTEND;TZID=Europe/Stockholm:20261012T170000',
    'SUMMARY:Weekly review - moved',
    'X-OVERRIDE-MARKER;X-ORIGIN=external:preserve-exception',
    'END:VEVENT',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260922T120000Z',
    'RECURRENCE-ID;TZID=Europe/Stockholm:20261019T140000',
    'DTSTART;TZID=Europe/Stockholm:20261019T140000',
    'DTEND;TZID=Europe/Stockholm:20261019T150000',
    'STATUS:CANCELLED',
    'X-OVERRIDE-MARKER;X-ORIGIN=external:preserve-cancellation',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function expectRecurringResourceProperties(
  icalendar: string,
  uid: string,
): void {
  expect(
    Array.from(
      icalendar.matchAll(/^UID:([^\r\n]+)\r?$/gm),
      ([, value]) => value,
    ),
  ).toEqual([uid, uid, uid]);
  expect(icalendar).toContain('RRULE:FREQ=WEEKLY;COUNT=4');
  expect(icalendar).toContain('RDATE;TZID=Europe/Stockholm:20261026T140000');
  expect(icalendar).toContain('EXDATE;TZID=Europe/Stockholm:20261102T140000');
  expect(icalendar).toContain(
    'RECURRENCE-ID;TZID=Europe/Stockholm:20261012T140000',
  );
  expect(icalendar).toContain(
    'RECURRENCE-ID;TZID=Europe/Stockholm:20261019T140000',
  );
  expect(icalendar).toContain('DTSTART;TZID=Europe/Stockholm:20261019T140000');
  expect(icalendar).toContain('DTEND;TZID=Europe/Stockholm:20261019T150000');
  expect(icalendar).toContain('STATUS:CANCELLED');
  expect(icalendar).toContain('BEGIN:VTIMEZONE');
  expect(icalendar).toContain(
    'X-CUSTOM-CALENDAR-PROPERTY:preserve-resource-value',
  );
  expect(icalendar).toContain(
    'X-CLIENT-METADATA;X-PARAM=preserve-param:preserve-value',
  );
  expect(icalendar).toContain(
    'X-OVERRIDE-MARKER;X-ORIGIN=external:preserve-exception',
  );
  expect(icalendar).toContain(
    'X-OVERRIDE-MARKER;X-ORIGIN=external:preserve-cancellation',
  );
}

async function directGet(
  url: string,
  credentials: CalDavCredentialProvider,
): Promise<{ body: string; etag: string }> {
  const response = await fetch(url, {
    headers: await credentials.getRequestHeaders(),
  });

  expect(response.ok).toBe(true);
  const etag = response.headers.get('ETag');
  expect(etag).toBeTruthy();

  return {
    body: await response.text(),
    etag: etag!,
  };
}

async function directPut(
  url: string,
  etag: string,
  body: string,
  credentials: CalDavCredentialProvider,
): Promise<void> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...(await credentials.getRequestHeaders()),
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-Match': etag,
    },
    body,
  });

  expect(response.ok).toBe(true);
}

function basicCredentialProvider(
  username: string,
  credential: string,
): CalDavCredentialProvider {
  return {
    async getRequestHeaders() {
      return {
        Authorization: `Basic ${Buffer.from(
          `${username}:${credential}`,
          'utf8',
        ).toString('base64')}`,
      };
    },
  };
}
