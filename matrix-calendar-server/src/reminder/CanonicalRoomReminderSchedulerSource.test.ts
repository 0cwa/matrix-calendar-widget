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

import { readFileSync } from 'fs';
import { join } from 'path';
import { IAppConfiguration } from '../IAppConfiguration';
import { CalDavEventClient } from '../caldav/CalDavEventClient';
import { ICalendarEventCodec } from '../caldav/ICalendarEventCodec';
import { MatrixOpenIdCalDavCredentialProviderFactory } from '../caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import { RoomCalendarCalDavAccess } from '../service/RoomCalendarCalDavAccess';
import {
  CanonicalReminderSourceError,
  CanonicalRoomReminderSchedulerSource,
} from './CanonicalRoomReminderSchedulerSource';
import { ReminderSchedulerWindow } from './RoomReminderScheduler';
import { RoomReminderConfiguration } from './RoomReminderStore';

const roomId = '!planning:example.test';
const calendarId = 'room-calendar';
const eventUid = 'team-planning@example.test';
const alarmUid = 'master-alarm@example.test';
const calendarUrl = 'https://radicale.example.test/service/room-calendar/';
const fixturePath = join(
  __dirname,
  '../../../fixtures/ical/reminder-identity-resource.ics',
);
const fixture = readFileSync(fixturePath, 'utf8');
const supportedFixture = fixture.replace(
  /BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r?\n/,
  '',
);

function configuration(
  overrides: Partial<RoomReminderConfiguration> = {},
): RoomReminderConfiguration {
  return {
    roomId,
    calendarId,
    eventUid,
    recurrenceId: null,
    alarmUid,
    ...overrides,
  };
}

function window(notBefore: string, through: string): ReminderSchedulerWindow {
  return {
    notBefore: new Date(notBefore),
    through: new Date(through),
  };
}

function davResponse(icalendar: string, filename = 'team-planning.ics') {
  return davResponseWithResources([{ icalendar, filename }]);
}

function davResponseWithResources(
  resources: readonly { icalendar: string; filename: string }[],
) {
  return new Response(
    `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  ${resources
    .map(
      ({ icalendar, filename }, index) => `
    <d:response>
      <d:href>/service/room-calendar/${filename}</d:href>
      <d:propstat>
        <d:prop>
          <d:getetag>"v${index + 1}"</d:getetag>
          <c:calendar-data><![CDATA[${icalendar}]]></c:calendar-data>
        </d:prop>
        <d:status>HTTP/1.1 200 OK</d:status>
      </d:propstat>
    </d:response>`,
    )
    .join('')}
</d:multistatus>`,
    { headers: { 'Content-Type': 'application/xml' } },
  );
}

function createSource(
  fetchImpl: typeof fetch,
  options: { yieldToEventLoop?: (signal: AbortSignal) => Promise<void> } = {},
) {
  const access = {
    forAuthorizedTarget: jest.fn(async () => ({
      userId: '@calendar-service:example.test',
      calendarUrl,
      credential: {
        accessToken: 'test-token',
        matrixServerName: 'example.test',
      },
    })),
  } as unknown as RoomCalendarCalDavAccess;
  const credentialProviderFactory = {
    forPrincipal: jest.fn(() => ({
      getRequestHeaders: jest.fn(async () => ({
        Authorization: 'Bearer synthetic-test-proof',
      })),
    })),
  } as unknown as MatrixOpenIdCalDavCredentialProviderFactory;
  const appConfig = {
    caldav_max_event_response_bytes: 2 * 1024 * 1024,
  } as IAppConfiguration;
  const source = new CanonicalRoomReminderSchedulerSource(
    appConfig,
    access,
    credentialProviderFactory,
    { fetchImpl, ...options },
  );
  return { source, access };
}

function createFetchMock(...icalendars: string[]): jest.Mock {
  const responses = icalendars.map((icalendar, index) =>
    davResponse(icalendar, `team-planning-${index}.ics`),
  );
  return jest
    .fn()
    .mockImplementation(
      async () => responses.shift() ?? davResponse(supportedFixture),
    );
}

describe('CanonicalRoomReminderSchedulerSource', () => {
  it('loads the exact UID response and parses its canonical event model', async () => {
    const fetchMock = createFetchMock(supportedFixture);
    const client = new CalDavEventClient(
      { getRequestHeaders: async () => ({ Authorization: 'Bearer proof' }) },
      fetchMock as typeof fetch,
    );
    const [resource] = await client.listEventsByUid(calendarUrl, eventUid);

    expect(resource.href).toBe(`${calendarUrl}team-planning-0.ics`);
    expect(
      new ICalendarEventCodec().parse(
        calendarId,
        resource.href,
        resource.icalendar,
      ).event.uid,
    ).toBe(eventUid);
  });

  it('queries one configured collection by UID and keys later RRULE firings by actual typed DTSTART', async () => {
    const fetchMock = createFetchMock(supportedFixture);
    const { source, access } = createSource(fetchMock as typeof fetch);
    const signal = new AbortController().signal;
    const dueWindow = window(
      '2026-10-19T06:40:00.000Z',
      '2026-10-19T06:50:00.000Z',
    );

    const candidates = await source.listDueCandidates(
      configuration(),
      dueWindow,
      undefined,
      1,
      signal,
    );

    expect(access.forAuthorizedTarget).toHaveBeenCalledWith(
      {
        roomId,
        calendarId,
        principal: { kind: 'service' },
      },
      'read',
      signal,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, request] = fetchMock.mock.calls[0];
    expect(requestUrl).toBe(calendarUrl);
    expect(request.method).toBe('REPORT');
    expect(request.signal).toBe(signal);
    expect(request.body).toContain(
      '<C:text-match collation="i;octet" match-type="equals">team-planning@example.test</C:text-match>',
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].dueAt.toISOString()).toBe('2026-10-19T06:45:00.000Z');
    expect(JSON.parse(candidates[0].identity.recurrenceId)).toEqual([
      'date-time',
      'tzid',
      'Europe/Stockholm',
      '2026-10-19T09:00:00',
    ]);
    expect(candidates[0].identity).toEqual({
      roomId,
      calendarId,
      eventUid,
      recurrenceId: candidates[0].identity.recurrenceId,
      alarmUid,
      triggerOrdinal: 0,
    });

    const current = await source.resolveCurrentDelivery(
      configuration(),
      candidates[0].identity,
      dueWindow,
      signal,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(current).toEqual({
      dueAt: candidates[0].dueAt,
      body: 'Reminder: Private planning title',
    });
  });

  it('does not deliver stale relative reminder intent after the current alarm becomes absolute', async () => {
    const absoluteFixture = supportedFixture.replace(
      'TRIGGER:-PT15M',
      'TRIGGER;VALUE=DATE-TIME:20261019T064500Z',
    );
    const fetchMock = createFetchMock(absoluteFixture, absoluteFixture);
    const { source } = createSource(fetchMock as typeof fetch);
    const signal = new AbortController().signal;
    const dueWindow = window(
      '2026-10-19T06:40:00.000Z',
      '2026-10-19T06:50:00.000Z',
    );
    const staleIdentity = {
      roomId,
      calendarId,
      eventUid,
      recurrenceId: JSON.stringify([
        'date-time',
        'tzid',
        'Europe/Stockholm',
        '2026-10-19T09:00:00',
      ]),
      alarmUid,
      triggerOrdinal: 0,
    };

    await expect(
      source.listDueCandidates(
        configuration(),
        dueWindow,
        undefined,
        1,
        signal,
      ),
    ).rejects.toMatchObject({
      name: 'CanonicalReminderSourceError',
      code: 'unavailable',
    });
    await expect(
      source.resolveCurrentDelivery(
        configuration(),
        staleIdentity,
        dueWindow,
        signal,
      ),
    ).rejects.toMatchObject({
      name: 'CanonicalReminderSourceError',
      code: 'unavailable',
    });
  });

  it('does not inherit master alarms onto detached overrides but keeps explicit override alarms', async () => {
    const unarmedOverrideFixture = supportedFixture.replace(
      'BEGIN:VEVENT\nUID:unrelated@example.test',
      [
        'BEGIN:VEVENT',
        'UID:team-planning@example.test',
        'DTSTAMP:20260926T120000Z',
        'RECURRENCE-ID;TZID=Europe/Stockholm:20261019T090000',
        'DTSTART;TZID=Europe/Stockholm:20261019T130000',
        'DTEND;TZID=Europe/Stockholm:20261019T140000',
        'SUMMARY:Private moved occurrence without alarm',
        'END:VEVENT',
        'BEGIN:VEVENT\nUID:unrelated@example.test',
      ].join('\n'),
    );
    const fetchMock = createFetchMock(
      unarmedOverrideFixture,
      unarmedOverrideFixture,
      unarmedOverrideFixture,
    );
    const { source } = createSource(fetchMock as typeof fetch);
    const signal = new AbortController().signal;

    const masterAlarmOnOverrideWithDifferentAlarm =
      await source.listDueCandidates(
        configuration(),
        window('2026-10-12T08:40:00.000Z', '2026-10-12T08:50:00.000Z'),
        undefined,
        1,
        signal,
      );
    const masterAlarmOnOverrideWithoutAlarm = await source.listDueCandidates(
      configuration(),
      window('2026-10-19T10:40:00.000Z', '2026-10-19T10:50:00.000Z'),
      undefined,
      1,
      signal,
    );

    expect(masterAlarmOnOverrideWithDifferentAlarm).toEqual([]);
    expect(masterAlarmOnOverrideWithoutAlarm).toEqual([]);

    const overrideCandidates = await source.listDueCandidates(
      configuration({
        recurrenceId: JSON.stringify([
          'date-time',
          'tzid',
          'Europe/Stockholm',
          '2026-10-12T09:00:00',
        ]),
        alarmUid: 'override-alarm@example.test',
      }),
      window('2026-10-12T08:35:00.000Z', '2026-10-12T08:45:00.000Z'),
      undefined,
      1,
      signal,
    );

    expect(overrideCandidates).toHaveLength(1);
    expect(overrideCandidates[0].identity.alarmUid).toBe(
      'override-alarm@example.test',
    );
    expect(overrideCandidates[0].identity.recurrenceId).toBe(
      JSON.stringify([
        'date-time',
        'tzid',
        'Europe/Stockholm',
        '2026-10-12T09:00:00',
      ]),
    );
    expect(overrideCandidates[0].dueAt.toISOString()).toBe(
      '2026-10-12T08:40:00.000Z',
    );
  });

  it('removes bidirectional and zero-width format controls from ephemeral reminder titles', async () => {
    const unsafeTitleFixture = supportedFixture.replace(
      'SUMMARY:Private planning title',
      'SUMMARY:Private\u200B\u202Eplanning title',
    );
    const fetchMock = createFetchMock(unsafeTitleFixture, unsafeTitleFixture);
    const { source } = createSource(fetchMock as typeof fetch);
    const dueWindow = window(
      '2026-10-19T06:40:00.000Z',
      '2026-10-19T06:50:00.000Z',
    );
    const signal = new AbortController().signal;
    const [candidate] = await source.listDueCandidates(
      configuration(),
      dueWindow,
      undefined,
      1,
      signal,
    );

    const current = await source.resolveCurrentDelivery(
      configuration(),
      candidate.identity,
      dueWindow,
      signal,
    );

    expect(current?.body).toBe('Reminder: Private planning title');
    expect(current?.body).not.toMatch(/[\u200B\u202E]/u);
  });

  it('re-reads the current canonical alarm after a claim and drops a firing moved outside its due window', async () => {
    const changedAlarm = supportedFixture.replace(
      'TRIGGER:-PT15M',
      'TRIGGER:-PT30M',
    );
    const fetchMock = createFetchMock(supportedFixture, changedAlarm);
    const { source } = createSource(fetchMock as typeof fetch);
    const dueWindow = window(
      '2026-10-19T06:40:00.000Z',
      '2026-10-19T06:50:00.000Z',
    );
    const [candidate] = await source.listDueCandidates(
      configuration(),
      dueWindow,
      undefined,
      1,
      new AbortController().signal,
    );

    const current = await source.resolveCurrentDelivery(
      configuration(),
      candidate.identity,
      dueWindow,
      new AbortController().signal,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(current).toBeUndefined();
  });

  it('fails closed when the exact UID matches more than one canonical resource', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      davResponseWithResources([
        { icalendar: supportedFixture, filename: 'team-planning-one.ics' },
        { icalendar: supportedFixture, filename: 'team-planning-two.ics' },
      ]),
    );
    const { source } = createSource(fetchMock as typeof fetch);

    await expect(
      source.listDueCandidates(
        configuration(),
        window('2026-10-19T06:40:00.000Z', '2026-10-19T06:50:00.000Z'),
        undefined,
        1,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      name: CanonicalReminderSourceError.name,
      code: 'ambiguous-resource',
    });
  });

  it('maps CalDAV transport failures to a fixed safe source error', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValue(new Error('Bearer secret and private calendar data'));
    const { source } = createSource(fetchMock as typeof fetch);

    await expect(
      source.listDueCandidates(
        configuration(),
        window('2026-10-19T06:40:00.000Z', '2026-10-19T06:50:00.000Z'),
        undefined,
        1,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      name: CanonicalReminderSourceError.name,
      code: 'unavailable',
      message: 'Canonical reminder source failed (unavailable)',
    });
  });

  it('stops between bounded recurrence projection chunks when aborted', async () => {
    const fetchMock = createFetchMock(supportedFixture);
    const controller = new AbortController();
    const yieldToEventLoop = jest.fn(async () => controller.abort());
    const { source } = createSource(fetchMock as typeof fetch, {
      yieldToEventLoop,
    });

    await expect(
      source.listDueCandidates(
        configuration(),
        window('2026-10-19T06:40:00.000Z', '2026-10-19T06:50:00.000Z'),
        undefined,
        1,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(yieldToEventLoop).toHaveBeenCalledTimes(1);
  });
});
