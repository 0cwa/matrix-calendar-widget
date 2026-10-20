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
import { resolveRoomCalendarBinding } from '../service/RoomCalendarBindingResolver';
import { DisabledRoomCalendarBindingStore } from '../service/DisabledRoomCalendarBindingStore';
import type { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import type { RoomCalendarBindingRegistry } from '../service/IRoomCalendarBindingRegistry';
import { RoomCalendarBindingRegistryAdapter } from '../service/RoomCalendarBindingRegistryAdapter';
import type {
  RoomCalendarPrincipalIdentity,
  RoomCalendarPrincipalIdentityProvider,
} from '../service/RoomCalendarPrincipalIdentity';
import { RoomReminderScheduler } from './RoomReminderScheduler';
import {
  ConfiguredReminderSchedulerRuntimeSource,
  RoomReminderSchedulerLifecycle,
} from './RoomReminderSchedulerRuntime';
import { RoomReminderStore } from './RoomReminderStore';

const roomId = '!team:example.test';
const calendarId = 'team-calendar';
const appserviceIdentity: RoomCalendarPrincipalIdentity = Object.freeze({
  mode: 'appservice',
  userId: '@calendar_bot:example.test',
});
const botAccountIdentity: RoomCalendarPrincipalIdentity = Object.freeze({
  mode: 'bot-account',
  userId: '@normal_bot:example.test',
});

function configuration(
  overrides: Partial<IAppConfiguration> = {},
): IAppConfiguration {
  return {
    access_token: 'synthetic-user-access-token',
    homeserver_url: 'https://matrix.example.test',
    radicale_url: 'https://radicale.example.test/caldav/',
    room_calendar_bindings: [{ roomId, calendarId }],
    room_calendar_principal_mode: 'appservice',
    room_calendar_access_enabled: true,
    room_calendar_event_writes_enabled: false,
    room_reminder_delivery_enabled: true,
    application_service_token: 'synthetic-appservice-token',
    application_service_user_id: '@calendar_bot:example.test',
    ...overrides,
  } as IAppConfiguration;
}

function identityProvider(
  identity: RoomCalendarPrincipalIdentity = appserviceIdentity,
): RoomCalendarPrincipalIdentityProvider {
  return { resolve: jest.fn(async () => identity) };
}

function store(enabled: boolean): RoomReminderStore {
  return { enabled } as RoomReminderStore;
}

function createRuntimeSource(
  appConfig: IAppConfiguration,
  reminderStore: RoomReminderStore,
  principalIdentityProvider: RoomCalendarPrincipalIdentityProvider,
): ConfiguredReminderSchedulerRuntimeSource {
  return new ConfiguredReminderSchedulerRuntimeSource(
    appConfig,
    reminderStore,
    principalIdentityProvider,
    new RoomCalendarBindingRegistryAdapter(
      appConfig.room_calendar_bindings,
      new DisabledRoomCalendarBindingStore(),
    ),
  );
}

describe('ConfiguredReminderSchedulerRuntimeSource', () => {
  it('returns only current bindings when every delivery prerequisite is enabled', async () => {
    const source = createRuntimeSource(
      configuration(),
      store(true),
      identityProvider(),
    );

    await expect(
      source.getCurrentConfiguration(new AbortController().signal),
    ).resolves.toEqual({
      roomCalendarBindings: [{ roomId, calendarId }],
      roomCalendarPrincipalIdentity: appserviceIdentity,
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
    const appConfig = configuration(overrides as Partial<IAppConfiguration>);
    const source = createRuntimeSource(
      appConfig,
      store(dbOn as boolean),
      identityProvider(),
    );

    const result = await source.getCurrentConfiguration(
      new AbortController().signal,
    );
    expect(result.roomCalendarBindings).toEqual([]);
    expect(result.roomCalendarPrincipalIdentity).toBeUndefined();
  });

  it('resolves the bot account without application-service credentials', async () => {
    const provider = identityProvider(botAccountIdentity);
    const appConfig = configuration({
        room_calendar_principal_mode: 'bot-account',
        application_service_token: undefined,
        application_service_user_id: undefined,
      });
    const source = createRuntimeSource(
      appConfig,
      store(true),
      provider,
    );

    const result = await source.getCurrentConfiguration(
      new AbortController().signal,
    );

    expect(result.roomCalendarBindings).toEqual([{ roomId, calendarId }]);
    expect(result.roomCalendarPrincipalIdentity).toBe(botAccountIdentity);
    expect(provider.resolve).toHaveBeenCalledTimes(1);
  });

  it('clears bindings when the shared provider rejects or selects another mode', async () => {
    const rejectingProvider: RoomCalendarPrincipalIdentityProvider = {
      resolve: jest.fn(async () => {
        throw new Error('private identity details');
      }),
    };
    const rejectedSource = createRuntimeSource(
      configuration(),
      store(true),
      rejectingProvider,
    );
    const rejected = await rejectedSource.getCurrentConfiguration(
      new AbortController().signal,
    );
    expect(rejected.roomCalendarBindings).toEqual([]);
    expect(rejected.roomCalendarPrincipalIdentity).toBeUndefined();

    const mismatchedConfig = configuration({
      room_calendar_principal_mode: 'bot-account',
    });
    const mismatchedSource = createRuntimeSource(
      mismatchedConfig,
      store(true),
      identityProvider(appserviceIdentity),
    );
    const mismatched = await mismatchedSource.getCurrentConfiguration(
      new AbortController().signal,
    );
    expect(mismatched.roomCalendarBindings).toEqual([]);
    expect(mismatched.roomCalendarPrincipalIdentity).toBeUndefined();
  });

  it('uses a fresh append-only binding snapshot for post-claim checks and the next scan', async () => {
    const originalBinding = { roomId, calendarId };
    const newlyReadyBinding = {
      roomId: '!next:example.test',
      calendarId: 'next-calendar',
    };
    let currentBindings: readonly RoomCalendarBinding[] = [originalBinding];
    const registry: RoomCalendarBindingRegistry = {
      getSnapshot: jest.fn(async () => currentBindings),
      resolve: async (targetRoomId, targetCalendarId) =>
        resolveRoomCalendarBinding(
          currentBindings,
          targetRoomId,
          targetCalendarId,
        ),
    };
    const source = new ConfiguredReminderSchedulerRuntimeSource(
      configuration(),
      store(true),
      identityProvider(),
      registry,
    );
    const signal = new AbortController().signal;

    const scanSnapshot = await source.getCurrentConfiguration(signal);
    currentBindings = [originalBinding, newlyReadyBinding];
    const postClaimSnapshot = await source.getCurrentConfiguration(signal);
    const nextScanSnapshot = await source.getCurrentConfiguration(signal);

    expect(scanSnapshot.roomCalendarBindings).toEqual([originalBinding]);
    expect(postClaimSnapshot.roomCalendarBindings).toEqual([
      originalBinding,
      newlyReadyBinding,
    ]);
    expect(nextScanSnapshot.roomCalendarBindings).toEqual([
      originalBinding,
      newlyReadyBinding,
    ]);
    expect(registry.getSnapshot).toHaveBeenCalledTimes(3);
  });

  it('rejects an already-aborted read before returning operator configuration', async () => {
    const source = createRuntimeSource(
      configuration(),
      store(true),
      identityProvider(),
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      source.getCurrentConfiguration(controller.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('honors cancellation while resolving the shared identity', async () => {
    let resolveIdentity!: (identity: RoomCalendarPrincipalIdentity) => void;
    let notifyIdentityStarted!: () => void;
    const identityStarted = new Promise<void>((resolve) => {
      notifyIdentityStarted = resolve;
    });
    const provider: RoomCalendarPrincipalIdentityProvider = {
      resolve: jest.fn(
        () => {
          notifyIdentityStarted();
          return new Promise<RoomCalendarPrincipalIdentity>((resolve) => {
            resolveIdentity = resolve;
          });
        },
      ),
    };
    const source = createRuntimeSource(
      configuration(),
      store(true),
      provider,
    );
    const controller = new AbortController();
    const result = source.getCurrentConfiguration(controller.signal);

    await identityStarted;
    expect(provider.resolve).toHaveBeenCalledTimes(1);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    resolveIdentity(appserviceIdentity);
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

  it('starts bot-account delivery readiness without application-service credentials', async () => {
    jest.useFakeTimers();
    const scheduler = { runOnce: jest.fn(async () => ({})) } as unknown as Pick<
      RoomReminderScheduler,
      'runOnce'
    >;
    const lifecycle = new RoomReminderSchedulerLifecycle(
      configuration({
        room_calendar_principal_mode: 'bot-account',
        application_service_token: undefined,
        application_service_user_id: undefined,
      }),
      store(true),
      scheduler,
    );

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(scheduler.runOnce).toHaveBeenCalledTimes(1);
    await lifecycle.stop();
  });
});
