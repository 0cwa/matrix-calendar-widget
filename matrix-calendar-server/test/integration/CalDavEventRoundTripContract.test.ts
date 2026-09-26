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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const password = process.env.CALDAV_PASSWORD ?? 'calendar-dev-password';
  const calendarUrl = new URL(
    `${encodeURIComponent(username)}/contract-calendar/`,
    baseUrl,
  ).toString();
  const eventUrl = new URL('round-trip.ics', calendarUrl).toString();
  const credentials = basicCredentialProvider(username, password);
  const codec = new ICalendarEventCodec();
  let client: CalDavEventClient;
  let cleanupResourceUrl: string | undefined;

  beforeAll(() => {
    fetchMock.disableMocks();
    client = new CalDavEventClient(credentials);
  });

  afterEach(async () => {
    if (!cleanupResourceUrl) {
      return;
    }

    const resourceUrl = cleanupResourceUrl;
    cleanupResourceUrl = undefined;

    try {
      const resource = await client.getEvent(resourceUrl);
      await client.deleteEvent(resourceUrl, resource.etag);
    } catch {
      // Cleanup is best-effort and targets only this test's unique resource.
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
          local: '2030-01-15T10:00:00',
          timezone: 'UTC',
        },
        end: {
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
    const source = readFileSync(
      join(__dirname, '../../../fixtures/ical/recurrence-override.ics'),
      'utf8',
    ).replace(/override@example\.test/g, uid);

    await client.createEvent(resourceUrl, source);
    cleanupResourceUrl = resourceUrl;

    const createdResource = await client.getEvent(resourceUrl);
    expect(createdResource.href).toBe(resourceUrl);
    expect(createdResource.etag).toBeTruthy();
    expect(createdResource.icalendar.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(
      Array.from(
        createdResource.icalendar.matchAll(/^UID:([^\r\n]+)\r?$/gm),
        ([, value]) => value,
      ),
    ).toEqual([uid, uid, uid]);

    const initial = codec.parse(
      calendarUrl,
      resourceUrl,
      createdResource.icalendar,
    );
    expect(initial.event.uid).toBe(uid);
    expect(initial.event.recurrence).toMatchObject({
      rrule: 'FREQ=WEEKLY;COUNT=4',
      rdates: [
        {
          type: 'date-time',
          value: {
            local: '2026-10-26T14:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
      ],
      exdates: [
        {
          type: 'date-time',
          value: {
            local: '2026-11-02T14:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
      ],
      overrides: [
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-10-12T14:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
          title: 'Weekly review - moved',
          timing: {
            type: 'timed',
            start: {
              local: '2026-10-12T16:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
        },
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-10-19T14:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
          status: 'cancelled',
          timing: undefined,
        },
      ],
    });

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
    expect(afterPatch.icalendar.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(
      Array.from(
        afterPatch.icalendar.matchAll(/^UID:([^\r\n]+)\r?$/gm),
        ([, value]) => value,
      ),
    ).toEqual([uid, uid, uid]);
    expect(verified.event).toMatchObject({
      uid,
      location: 'Interoperability room',
      timing: {
        type: 'timed',
        start: {
          local: '2026-10-05T14:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
    });
    expect(verified.event.recurrence).toEqual(initial.event.recurrence);
    expect(afterPatch.icalendar).toContain('BEGIN:VTIMEZONE');
    expect(afterPatch.icalendar).toContain(
      'X-CUSTOM-CALENDAR-PROPERTY:preserve-resource-value',
    );
    expect(afterPatch.icalendar).toContain(
      'X-CLIENT-METADATA;X-PARAM=preserve-param:preserve-value',
    );
    expect(afterPatch.icalendar).toContain(
      'X-OVERRIDE-MARKER;X-ORIGIN=external:preserve-exception',
    );
    expect(afterPatch.icalendar).toContain(
      'X-OVERRIDE-MARKER;X-ORIGIN=external:preserve-cancellation',
    );
  });
});

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
  password: string,
): CalDavCredentialProvider {
  return {
    async getRequestHeaders() {
      return {
        Authorization: `Basic ${Buffer.from(
          `${username}:${password}`,
          'utf8',
        ).toString('base64')}`,
      };
    },
  };
}
