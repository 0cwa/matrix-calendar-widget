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
import { IAppConfiguration } from '../../src/IAppConfiguration';
import { CalDavEventClient } from '../../src/caldav/CalDavEventClient';
import { MatrixOpenIdCalDavCredentialProviderFactory } from '../../src/caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import { CanonicalRoomReminderSchedulerSource } from '../../src/reminder/CanonicalRoomReminderSchedulerSource';
import { MatrixAppServiceReminderTransport } from '../../src/reminder/MatrixAppServiceReminderTransport';
import { buildRoomMentionMessage } from '../../src/reminder/RoomMentionMessage';
import {
  ROOM_REMINDER_SCHEDULER_LIMITS,
  RoomReminderScheduler,
} from '../../src/reminder/RoomReminderScheduler';
import { ConfiguredReminderSchedulerRuntimeSource } from '../../src/reminder/RoomReminderSchedulerRuntime';
import {
  createReminderDeliveryKey,
  RoomReminderConfiguration,
} from '../../src/reminder/RoomReminderStore';
import { RoomCalendarCalDavAccess } from '../../src/service/RoomCalendarCalDavAccess';
import { InMemoryRoomReminderStore } from '../util/InMemoryRoomReminderStore';

const describeContract =
  process.env.CALDAV_CONTRACT === '1' ? describe : describe.skip;
const serviceToken = process.env.MATRIX_APPLICATION_SERVICE_TOKEN ?? '';
const serviceUserId =
  process.env.MATRIX_APPLICATION_SERVICE_USER_ID ??
  '@_matrix_calendar_service:localhost';
const radicaleBaseUrl = process.env.CALDAV_BASE_URL ?? 'http://localhost:5232/';
const homeserverUrl =
  process.env.MATRIX_CALENDAR_DEV_HOMESERVER_URL ?? 'http://localhost:8008';

const testConfiguration = {
  homeserver_url: homeserverUrl,
  radicale_url: radicaleBaseUrl,
  room_calendar_access_enabled: true,
  room_calendar_event_writes_enabled: true,
  room_reminder_configuration_enabled: true,
  room_reminder_delivery_enabled: true,
  application_service_token: serviceToken,
  application_service_user_id: serviceUserId,
  room_calendar_bindings: [],
  caldav_max_event_response_bytes: 4 * 1024 * 1024,
} as unknown as IAppConfiguration;

type MatrixEvent = {
  event_id?: unknown;
  type?: unknown;
  content?: Record<string, unknown>;
};

let nativeFetch: typeof fetch;
let serviceUserAccessToken: string;
let roomId: string;
let calendarId: string;
let eventUid: string;
let alarmUid: string;
let scanNow: Date;
let configuration: RoomReminderConfiguration;
let store: InMemoryRoomReminderStore;
let access: RoomCalendarCalDavAccess;
let credentialFactory: MatrixOpenIdCalDavCredentialProviderFactory;
let canonicalSource: CanonicalRoomReminderSchedulerSource;
let matrixTransport: MatrixAppServiceReminderTransport;
let runtime: ConfiguredReminderSchedulerRuntimeSource;
let uidReportCount = 0;
let uidQueryIncludedExpectedValue = false;
let transactionIds: string[] = [];
let transactionEventIds: string[] = [];

describeContract(
  'room reminder delivery against real Synapse and Radicale',
  () => {
    beforeAll(async () => {
      fetchMock.disableMocks();
      nativeFetch = globalThis.fetch.bind(globalThis);
      if (!serviceToken) {
        throw new Error('Synthetic application-service fixture is unavailable');
      }

      const registration = await matrixRequest<{
        user_id?: unknown;
        access_token?: unknown;
      }>('/_matrix/client/v3/register', {
        method: 'POST',
        token: serviceToken,
        body: {
          type: 'm.login.application_service',
          username: serviceUserId.slice(1).split(':')[0],
        },
      });
      if (
        registration.user_id !== serviceUserId ||
        typeof registration.access_token !== 'string'
      ) {
        throw new Error('Synthetic application-service fixture is unavailable');
      }
      serviceUserAccessToken = registration.access_token;

      const createdRoom = await matrixRequest<{ room_id?: unknown }>(
        '/_matrix/client/v3/createRoom',
        {
          method: 'POST',
          token: serviceUserAccessToken,
          body: {
            name: 'M6 room reminder delivery contract',
            preset: 'private_chat',
          },
        },
      );
      if (typeof createdRoom.room_id !== 'string') {
        throw new Error('Synthetic reminder room is unavailable');
      }
      roomId = createdRoom.room_id;
      calendarId = `reminder-contract-${randomUUID()}`;
      eventUid = `reminder-${randomUUID()}@example.test`;
      alarmUid = `alarm-${randomUUID()}@example.test`;
      scanNow = new Date(Math.floor(Date.now() / 1_000) * 1_000);

      const binding = { roomId, calendarId };
      testConfiguration.room_calendar_bindings = [binding];
      access = new RoomCalendarCalDavAccess(testConfiguration, nativeFetch);
      credentialFactory = new MatrixOpenIdCalDavCredentialProviderFactory();
      const principal = await access.forAuthorizedTarget(
        { roomId, calendarId, principal: { kind: 'service' } },
        'write',
      );
      const credentialProvider = credentialFactory.forPrincipal(
        principal.userId,
        principal.credential,
      );
      const credentials = await credentialProvider.getRequestHeaders();
      const createdCalendar = await nativeFetch(principal.calendarUrl, {
        method: 'MKCALENDAR',
        headers: {
          ...credentials,
          'Content-Type': 'application/xml; charset=utf-8',
        },
        body: '<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:"><D:set><D:prop><D:displayname>Reminder contract</D:displayname><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set></D:prop></D:set></C:mkcalendar>',
      });
      if (!createdCalendar.ok) {
        throw new Error('Synthetic reminder calendar is unavailable');
      }

      const eventStart = new Date(scanNow.getTime() + 10 * 60 * 1_000);
      const eventEnd = new Date(eventStart.getTime() + 60 * 60 * 1_000);
      const eventResourceUrl = new URL(
        'reminder.ics',
        principal.calendarUrl,
      ).toString();
      await new CalDavEventClient(credentialProvider, nativeFetch).createEvent(
        eventResourceUrl,
        reminderCalendar(eventUid, alarmUid, scanNow, eventStart, eventEnd),
      );

      configuration = {
        roomId,
        calendarId,
        eventUid,
        recurrenceId: null,
        alarmUid,
      };
      store = new InMemoryRoomReminderStore();
      await store.upsertConfiguration(configuration);
      runtime = new ConfiguredReminderSchedulerRuntimeSource(
        testConfiguration,
        store,
      );
      canonicalSource = new CanonicalRoomReminderSchedulerSource(
        testConfiguration,
        access,
        credentialFactory,
        { fetchImpl: recordCalDavRequest },
      );
      matrixTransport = new MatrixAppServiceReminderTransport(
        {
          homeserverUrl,
          applicationServiceToken: serviceToken,
          applicationServiceSenderUserId: serviceUserId,
        },
        runtime,
        recordMatrixRequest,
      );
    }, 30_000);

    beforeEach(() => {
      testConfiguration.room_calendar_bindings = [{ roomId, calendarId }];
      uidReportCount = 0;
      uidQueryIncludedExpectedValue = false;
      transactionIds = [];
      transactionEventIds = [];
    });

    afterAll(() => {
      fetchMock.enableMocks();
      fetchMock.dontMock();
    });

    it('claims a canonical due alarm, sends it, and deduplicates repeated stable transactions', async () => {
      const window = schedulerWindow();
      const [candidate] = await canonicalSource.listDueCandidates(
        configuration,
        window,
        undefined,
        1,
        new AbortController().signal,
      );
      expect(candidate).toBeDefined();
      expect(candidate.dueAt.getTime()).toBeGreaterThanOrEqual(
        window.notBefore.getTime(),
      );
      expect(candidate.dueAt.getTime()).toBeLessThanOrEqual(
        window.through.getTime(),
      );
      expect(JSON.parse(candidate.identity.recurrenceId)).toEqual([
        'date-time',
        'utc',
        '',
        formatLocal(eventStartForScan()),
      ]);

      const scheduler = createScheduler();
      const report = await scheduler.runOnce();
      expect(report.deliveryClaimsAcquired).toBe(1);
      expect(report.deliveriesSent).toBe(1);
      expect(uidReportCount).toBeGreaterThanOrEqual(2);
      expect(uidQueryIncludedExpectedValue).toBe(true);

      const transactionId = `mcal-reminder-${createReminderDeliveryKey(candidate.identity)}`;
      const delivery = await canonicalSource.resolveCurrentDelivery(
        configuration,
        candidate.identity,
        window,
        new AbortController().signal,
      );
      if (!delivery) {
        throw new Error('Canonical reminder delivery is unavailable');
      }
      const message = buildRoomMentionMessage(delivery.body);
      await matrixTransport.sendRoomMention(
        roomId,
        calendarId,
        message,
        transactionId,
        new AbortController().signal,
      );
      await matrixTransport.sendRoomMention(
        roomId,
        calendarId,
        message,
        transactionId,
        new AbortController().signal,
      );

      expect(transactionIds).toEqual([
        transactionId,
        transactionId,
        transactionId,
      ]);
      expect(transactionEventIds).toHaveLength(3);
      expect(new Set(transactionEventIds).size).toBe(1);

      const timeline = await matrixRequest<{ chunk?: MatrixEvent[] }>(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=100`,
        { method: 'GET', token: serviceUserAccessToken },
      );
      const matchingEvents = (timeline.chunk ?? []).filter(
        (event) =>
          event.type === 'm.room.message' &&
          event.content?.body === 'Reminder: Synthetic reminder event',
      );
      expect(matchingEvents).toHaveLength(1);
      expect(matchingEvents[0].content?.['m.mentions']).toEqual({ room: true });

      const retryReport = await scheduler.runOnce();
      expect(retryReport.deliveriesSent).toBe(0);
      expect(transactionIds).toHaveLength(3);
    }, 30_000);

    it('denies a changed room binding before making a UID REPORT request', async () => {
      testConfiguration.room_calendar_bindings = [
        { roomId, calendarId: `${calendarId}-different` },
      ];
      const report = await createScheduler().runOnce();

      expect(report.deliveriesDenied).toBeGreaterThan(0);
      expect(report.candidatePagesRead).toBe(0);
      expect(uidReportCount).toBe(0);
    }, 30_000);

    it('denies an encrypted room before making a UID REPORT request', async () => {
      await matrixRequest(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.encryption`,
        {
          method: 'PUT',
          token: serviceUserAccessToken,
          body: { algorithm: 'm.megolm.v1.aes-sha2' },
        },
      );
      const report = await createScheduler().runOnce();

      expect(report.deliveriesDenied).toBeGreaterThan(0);
      expect(report.candidatePagesRead).toBe(0);
      expect(uidReportCount).toBe(0);
    }, 30_000);
  },
);

function createScheduler(): RoomReminderScheduler {
  return new RoomReminderScheduler({
    store,
    runtime,
    canonical: canonicalSource,
    matrixState: matrixTransport,
    sender: matrixTransport,
    now: () => new Date(scanNow.getTime()),
  });
}

function schedulerWindow() {
  return {
    notBefore: new Date(
      scanNow.getTime() - ROOM_REMINDER_SCHEDULER_LIMITS.maxLatenessMs,
    ),
    through: new Date(scanNow.getTime()),
  };
}

function eventStartForScan(): Date {
  return new Date(scanNow.getTime() + 10 * 60 * 1_000);
}

function reminderCalendar(
  uid: string,
  selectedAlarmUid: string,
  timestamp: Date,
  start: Date,
  end: Date,
): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Matrix Calendar Widget//Reminder Contract//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatUtc(timestamp)}`,
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(end)}`,
    'SUMMARY:Synthetic reminder event',
    'BEGIN:VALARM',
    `UID:${selectedAlarmUid}`,
    'ACTION:DISPLAY',
    'TRIGGER:-PT15M',
    'DESCRIPTION:Synthetic reminder contract',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function formatUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function formatLocal(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '');
}

async function recordCalDavRequest(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === 'string' ? new URL(input) : new URL(input.toString());
  const method = init?.method ?? 'GET';
  if (url.origin === new URL(radicaleBaseUrl).origin && method === 'REPORT') {
    uidReportCount += 1;
    const body = typeof init?.body === 'string' ? init.body : '';
    if (
      body.includes(
        `<C:text-match collation="i;octet" match-type="equals">${eventUid}</C:text-match>`,
      )
    ) {
      uidQueryIncludedExpectedValue = true;
    }
  }
  return nativeFetch(input, init);
}

async function recordMatrixRequest(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === 'string' ? new URL(input) : new URL(input.toString());
  const response = await nativeFetch(input, init);
  const match = /\/send\/m\.room\.message\/(mcal-reminder-[a-f0-9]{64})$/.exec(
    url.pathname,
  );
  if (init?.method === 'PUT' && match) {
    transactionIds.push(match[1]);
    if (response.ok) {
      let body: { event_id?: unknown } | undefined;
      try {
        body = (await response.clone().json()) as { event_id?: unknown };
      } catch {
        body = undefined;
      }
      if (typeof body?.event_id === 'string') {
        transactionEventIds.push(body.event_id);
      }
    }
  }
  return response;
}

async function matrixRequest<T = unknown>(
  path: string,
  options: { method: string; token?: string; body?: unknown },
): Promise<T> {
  const response = await nativeFetch(new URL(path, homeserverUrl), {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  if (!response.ok) {
    throw new Error('Synthetic reminder Matrix request failed');
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error('Synthetic reminder Matrix response is invalid');
  }
}
