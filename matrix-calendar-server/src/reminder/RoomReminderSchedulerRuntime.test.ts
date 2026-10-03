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

import { IAppConfiguration } from '../IAppConfiguration';
import { RoomReminderScheduler } from './RoomReminderScheduler';
import {
  ConfiguredReminderSchedulerRuntimeSource,
  RoomReminderSchedulerLifecycle,
} from './RoomReminderSchedulerRuntime';
import { RoomReminderStore } from './RoomReminderStore';

const roomId = '!team:example.test';
const calendarId = 'team-calendar';

function configuration(
  overrides: Partial<IAppConfiguration> = {},
): IAppConfiguration {
  return {
    homeserver_url: 'https://matrix.example.test',
    radicale_url: 'https://radicale.example.test/caldav/',
    room_calendar_bindings: [{ roomId, calendarId }],
    room_calendar_access_enabled: true,
    room_calendar_event_writes_enabled: false,
    room_reminder_delivery_enabled: true,
    application_service_token: 'synthetic-appservice-token',
    application_service_user_id: '@calendar_bot:example.test',
    ...overrides,
  } as IAppConfiguration;
}

function store(enabled: boolean): RoomReminderStore {
  return { enabled } as RoomReminderStore;
}

describe('ConfiguredReminderSchedulerRuntimeSource', () => {
  it('returns only current bindings when every delivery prerequisite is enabled', async () => {
    const source = new ConfiguredReminderSchedulerRuntimeSource(
      configuration(),
      store(true),
    );

    await expect(
      source.getCurrentConfiguration(new AbortController().signal),
    ).resolves.toEqual({
      roomCalendarBindings: [{ roomId, calendarId }],
      applicationServiceSenderUserId: '@calendar_bot:example.test',
      roomCalendarAccessEnabled: true,
      roomReminderDeliveryEnabled: true,
      reminderStoreEnabled: true,
    });
  });

  it.each([
    ['delivery gate', { room_reminder_delivery_enabled: false }, true],
    ['room-read gate', { room_calendar_access_enabled: false }, true],
    ['database store', {}, false],
  ])('fails closed when the %s is disabled', async (_name, overrides, dbOn) => {
    const source = new ConfiguredReminderSchedulerRuntimeSource(
      configuration(overrides as Partial<IAppConfiguration>),
      store(dbOn as boolean),
    );

    const result = await source.getCurrentConfiguration(
      new AbortController().signal,
    );
    expect(result.roomCalendarBindings).toEqual([]);
    expect(result.applicationServiceSenderUserId).toBeUndefined();
  });

  it('rejects an already-aborted read before returning operator configuration', async () => {
    const source = new ConfiguredReminderSchedulerRuntimeSource(
      configuration(),
      store(true),
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      source.getCurrentConfiguration(controller.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('RoomReminderSchedulerLifecycle', () => {
  afterEach(() => jest.useRealTimers());

  it('stays inert when the explicit delivery gate is off', async () => {
    jest.useFakeTimers();
    const scheduler = { runOnce: jest.fn(async () => ({})) } as unknown as Pick<
      RoomReminderScheduler,
      'runOnce'
    >;
    const lifecycle = new RoomReminderSchedulerLifecycle(
      configuration({ room_reminder_delivery_enabled: false }),
      store(true),
      scheduler,
    );

    lifecycle.start();
    await jest.runOnlyPendingTimersAsync();

    expect(scheduler.runOnce).not.toHaveBeenCalled();
    await lifecycle.stop();
  });

  it('runs scans serially and awaits abort during shutdown', async () => {
    jest.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const scheduler = {
      runOnce: jest.fn(
        (signal?: AbortSignal) =>
          new Promise((resolve) => {
            observedSignal = signal;
            signal?.addEventListener('abort', () => resolve({}), {
              once: true,
            });
          }),
      ),
    } as unknown as Pick<RoomReminderScheduler, 'runOnce'>;
    const lifecycle = new RoomReminderSchedulerLifecycle(
      configuration(),
      store(true),
      scheduler,
      1_000,
    );

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(scheduler.runOnce).toHaveBeenCalledTimes(1);
    expect(observedSignal?.aborted).toBe(false);

    const stopped = lifecycle.stop();
    expect(observedSignal?.aborted).toBe(true);
    await stopped;
    await jest.runOnlyPendingTimersAsync();
    expect(scheduler.runOnce).toHaveBeenCalledTimes(1);
  });
});
