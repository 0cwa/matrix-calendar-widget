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

import type {
  CalDavDiscoveryResult,
  DiscoveredCalDavCalendar,
} from '../caldav/CalDavDiscoveryClient';
import type { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import type { RoomCalendarPrincipalOpenIdProofPort } from './RoomCalendarPrincipalOpenIdProofProvider';
import {
  RoomCalendarSetupCalDavProvisioner,
  RoomCalendarSetupDiscoveryPort,
} from './RoomCalendarSetupCalDavProvisioner';

const CALENDAR_HOME = 'https://radicale.example/user/calendar/';
const GENERATED_ID =
  'calendar-00000000-0000-4000-8000-000000000001';
const STATIC_ID = 'operator_calendar_1';
const DYNAMIC_BINDING = {
  roomId: '!room:matrix.org',
  calendarId: GENERATED_ID,
};

function collection(href: string, components = ['VEVENT']) {
  return { href, components, readOnly: false } satisfies DiscoveredCalDavCalendar;
}

function discovery(
  calendars: readonly DiscoveredCalDavCalendar[],
): CalDavDiscoveryResult {
  return {
    principalUrl: 'https://radicale.example/user/',
    calendarHomeUrl: CALENDAR_HOME,
    calendars: [...calendars],
  };
}

function makeProvisioner(
  client: RoomCalendarSetupDiscoveryPort,
  proofProvider = {
    request: jest.fn().mockResolvedValue({
      identity: { mode: 'bot-account', userId: '@calendar:matrix.org' },
      userId: '@calendar:matrix.org',
      credential: {
        accessToken: 'short-lived-proof',
        matrixServerName: 'matrix.org',
      },
    }),
  } as unknown as RoomCalendarPrincipalOpenIdProofPort,
) {
  const factory = jest.fn(() => client);
  const provisioner = new RoomCalendarSetupCalDavProvisioner(
    'https://radicale.example/user/',
    proofProvider,
    fetch,
    factory,
  );
  return { provisioner, factory, proofProvider };
}

describe('RoomCalendarSetupCalDavProvisioner', () => {
  test('static IDs can only be verified and are never created', async () => {
    const client: RoomCalendarSetupDiscoveryPort = {
      discover: jest.fn().mockResolvedValue(
        discovery([
          collection(`${CALENDAR_HOME}${STATIC_ID}/`),
        ]),
      ),
      createCalendar: jest.fn(),
    };
    const { provisioner, proofProvider } = makeProvisioner(client);
    const staticBinding: RoomCalendarBinding = {
      roomId: '!room:matrix.org',
      calendarId: STATIC_ID,
    };

    await expect(
      provisioner.reconcile(staticBinding, 'verify-only'),
    ).resolves.toBe('existing');
    await expect(
      provisioner.reconcile(staticBinding, 'create-if-missing'),
    ).resolves.toBe('conflict');

    expect(client.createCalendar).not.toHaveBeenCalled();
    expect(proofProvider.request).toHaveBeenCalledTimes(1);
  });

  test('verify-only preserves mixed and read-only collections that support VEVENT', async () => {
    const client: RoomCalendarSetupDiscoveryPort = {
      discover: jest.fn().mockResolvedValue(
        discovery([
          {
            ...collection(`${CALENDAR_HOME}${STATIC_ID}/`, [
              'VEVENT',
              'VTODO',
            ]),
            readOnly: true,
          },
        ]),
      ),
      createCalendar: jest.fn(),
    };
    const { provisioner } = makeProvisioner(client);
    const staticBinding: RoomCalendarBinding = {
      roomId: '!room:matrix.org',
      calendarId: STATIC_ID,
    };

    await expect(
      provisioner.reconcile(staticBinding, 'verify-only'),
    ).resolves.toBe('existing');
    expect(client.createCalendar).not.toHaveBeenCalled();
  });

  test('verify-only accepts an unknown component set without mutating the collection', async () => {
    const client: RoomCalendarSetupDiscoveryPort = {
      discover: jest.fn().mockResolvedValue(
        discovery([
          {
            href: `${CALENDAR_HOME}${STATIC_ID}/`,
            readOnly: false,
          },
        ]),
      ),
      createCalendar: jest.fn(),
    };
    const { provisioner } = makeProvisioner(client);

    await expect(
      provisioner.reconcile(
        { roomId: '!room:matrix.org', calendarId: STATIC_ID },
        'verify-only',
      ),
    ).resolves.toBe('existing');
    expect(client.createCalendar).not.toHaveBeenCalled();
  });

  test('verify-only rejects a collection that explicitly omits VEVENT', async () => {
    const client: RoomCalendarSetupDiscoveryPort = {
      discover: jest.fn().mockResolvedValue(
        discovery([
          collection(`${CALENDAR_HOME}${STATIC_ID}/`, ['VTODO']),
        ]),
      ),
      createCalendar: jest.fn(),
    };
    const { provisioner } = makeProvisioner(client);

    await expect(
      provisioner.reconcile(
        { roomId: '!room:matrix.org', calendarId: STATIC_ID },
        'verify-only',
      ),
    ).resolves.toBe('conflict');
    expect(client.createCalendar).not.toHaveBeenCalled();
  });

  test('creates only the exact pending ID when it is absent, then verifies VEVENT support', async () => {
    const client: RoomCalendarSetupDiscoveryPort = {
      discover: jest
        .fn()
        .mockResolvedValueOnce(discovery([]))
        .mockResolvedValueOnce(
          discovery([collection(`${CALENDAR_HOME}${GENERATED_ID}/`)]),
        ),
      createCalendar: jest.fn().mockResolvedValue(
        collection(`${CALENDAR_HOME}${GENERATED_ID}/`),
      ),
    };
    const { provisioner } = makeProvisioner(client);

    await expect(
      provisioner.reconcile(DYNAMIC_BINDING, 'create-if-missing'),
    ).resolves.toBe('created');

    expect(client.createCalendar).toHaveBeenCalledTimes(1);
    expect(client.createCalendar).toHaveBeenCalledWith(
      'Matrix Calendar',
      GENERATED_ID,
    );
  });

  test('a ready binding with a missing collection is reported missing and never recreated', async () => {
    const client: RoomCalendarSetupDiscoveryPort = {
      discover: jest.fn().mockResolvedValue(discovery([])),
      createCalendar: jest.fn(),
    };
    const { provisioner } = makeProvisioner(client);

    await expect(
      provisioner.reconcile(DYNAMIC_BINDING, 'verify-only'),
    ).resolves.toBe('missing');

    expect(client.createCalendar).not.toHaveBeenCalled();
  });

  test('a collection at another ID is not selected by matching display name', async () => {
    const client: RoomCalendarSetupDiscoveryPort = {
      discover: jest.fn().mockResolvedValue({
        ...discovery([
          {
            ...collection(`${CALENDAR_HOME}some-other-id/`),
            displayName: 'Matrix Calendar',
          },
        ]),
      }),
      createCalendar: jest.fn(),
    };
    const { provisioner } = makeProvisioner(client);

    await expect(
      provisioner.reconcile(DYNAMIC_BINDING, 'verify-only'),
    ).resolves.toBe('missing');
    expect(client.createCalendar).not.toHaveBeenCalled();
  });

  test('a discovered home that differs from the existing bound-access home is never provisioned', async () => {
    const client: RoomCalendarSetupDiscoveryPort = {
      discover: jest.fn().mockResolvedValue({
        ...discovery([
          collection('https://radicale.example/alternate/calendar-id/'),
        ]),
        calendarHomeUrl: 'https://radicale.example/alternate/',
      }),
      createCalendar: jest.fn(),
    };
    const { provisioner } = makeProvisioner(client);

    await expect(
      provisioner.reconcile(DYNAMIC_BINDING, 'create-if-missing'),
    ).rejects.toThrow('Room calendar home does not match bound access');

    expect(client.createCalendar).not.toHaveBeenCalled();
  });

  test.each([
    ['mixed component set', ['VEVENT', 'VTODO']],
    ['non-writable collection', ['VEVENT']],
  ])('%s at the exact ID is a conflict', async (label, components) => {
    const invalidCollection = collection(
      `${CALENDAR_HOME}${GENERATED_ID}/`,
      components,
    );
    const client: RoomCalendarSetupDiscoveryPort = {
      discover: jest.fn().mockResolvedValue(
        discovery([
          label === 'non-writable collection'
            ? { ...invalidCollection, readOnly: true }
            : invalidCollection,
        ]),
      ),
      createCalendar: jest.fn(),
    };
    const { provisioner } = makeProvisioner(client);

    await expect(
      provisioner.reconcile(DYNAMIC_BINDING, 'create-if-missing'),
    ).resolves.toBe('conflict');
    expect(client.createCalendar).not.toHaveBeenCalled();
  });

  test('after an ambiguous create error it inspects the same ID and preserves it', async () => {
    const client: RoomCalendarSetupDiscoveryPort = {
      discover: jest
        .fn()
        .mockResolvedValueOnce(discovery([]))
        .mockResolvedValueOnce(
          discovery([collection(`${CALENDAR_HOME}${GENERATED_ID}/`)]),
        ),
      createCalendar: jest.fn().mockRejectedValue(new Error('timeout')),
    };
    const { provisioner } = makeProvisioner(client);

    await expect(
      provisioner.reconcile(DYNAMIC_BINDING, 'create-if-missing'),
    ).resolves.toBe('existing');

    expect(client.discover).toHaveBeenCalledTimes(2);
    expect(client.createCalendar).toHaveBeenCalledTimes(1);
  });
});
