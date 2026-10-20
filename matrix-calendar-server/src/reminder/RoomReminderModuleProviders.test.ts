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

import { FactoryProvider } from '@nestjs/common';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import type {
  RoomCalendarPrincipalIdentity,
  RoomCalendarPrincipalIdentityProvider,
} from '../service/RoomCalendarPrincipalIdentity';
import { CanonicalRoomReminderSchedulerSource } from './CanonicalRoomReminderSchedulerSource';
import { RoomReminderAlarmOptionsService } from './RoomReminderAlarmOptionsService';
import { RoomReminderConfigurationService } from './RoomReminderConfigurationService';
import {
  createRoomReminderMatrixPorts,
  createRoomReminderModuleProviders,
  disabledRoomReminderMatrixPorts,
  RoomReminderMatrixPorts,
  RoomReminderTransportFactory,
} from './RoomReminderModuleProviders';
import {
  ReminderSchedulerRuntimeSource,
  RoomReminderScheduler,
} from './RoomReminderScheduler';
import {
  ConfiguredReminderSchedulerRuntimeSource,
  RoomReminderSchedulerLifecycle,
} from './RoomReminderSchedulerRuntime';
import type { RoomReminderStore } from './RoomReminderStore';

describe('room reminder module ports', () => {
  const runtime: ReminderSchedulerRuntimeSource = {
    getCurrentConfiguration: jest.fn(),
  };
  const appserviceIdentity: RoomCalendarPrincipalIdentity = Object.freeze({
    mode: 'appservice',
    userId: '@calendar-bot:example.test',
  });
  const principalIdentityProvider: RoomCalendarPrincipalIdentityProvider = {
    resolve: jest.fn(async () => appserviceIdentity),
  };

  it('does not construct a Matrix transport or perform I/O while both gates are off', async () => {
    const createTransport = jest.fn<
      RoomReminderMatrixPorts,
      Parameters<RoomReminderTransportFactory>
    >();
    const ports = createRoomReminderMatrixPorts(
      {
        room_reminder_configuration_enabled: false,
        room_reminder_delivery_enabled: false,
      } as unknown as IAppConfiguration,
      { enabled: false } as RoomReminderStore,
      runtime,
      principalIdentityProvider,
      createTransport,
    );

    expect(createTransport).not.toHaveBeenCalled();
    await expect(ports.isRoomEncrypted('!team:example.test')).rejects.toThrow(
      'Room reminder integrations are disabled',
    );
    expect(runtime.getCurrentConfiguration).not.toHaveBeenCalled();
  });

  it('creates one shared Matrix transport after validating enabled prerequisites', () => {
    const created: RoomReminderMatrixPorts = {
      isRoomEncrypted: jest.fn(),
      getJoinedRoomMembers: jest.fn(),
      getPowerLevels: jest.fn(),
      getRoomVersion: jest.fn(),
      sendRoomMention: jest.fn(),
    };
    const createTransport = jest.fn<
      RoomReminderMatrixPorts,
      Parameters<RoomReminderTransportFactory>
    >(() => created);
    const store = { enabled: true } as RoomReminderStore;
    const appConfig = {
      room_reminder_configuration_enabled: true,
      room_reminder_delivery_enabled: false,
      room_calendar_access_enabled: true,
      room_calendar_principal_mode: 'appservice',
      application_service_token: 'server-secret',
      application_service_user_id: '@calendar-bot:example.test',
      homeserver_url: 'https://matrix.example.test',
      radicale_url: 'https://dav.example.test/radicale',
      room_calendar_bindings: [
        { roomId: '!team:example.test', calendarId: 'team-calendar' },
      ],
    } as unknown as IAppConfiguration;

    expect(
      createRoomReminderMatrixPorts(
        appConfig,
        store,
        runtime,
        principalIdentityProvider,
        createTransport,
      ),
    ).toBe(created);
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith(
      {
        mode: 'appservice',
        homeserverUrl: 'https://matrix.example.test',
        applicationServiceToken: 'server-secret',
        applicationServiceSenderUserId: '@calendar-bot:example.test',
        principalIdentityProvider,
      },
      runtime,
    );
  });

  it.each([
    ['room read gate', { room_calendar_access_enabled: false }],
    ['homeserver URL', { homeserver_url: 'file:///etc/passwd' }],
    ['CalDAV URL', { radicale_url: 'https://dav.example.test/?token=x' }],
    ['application-service token', { application_service_token: ' ' }],
    [
      'bot-account access token',
      { room_calendar_principal_mode: 'bot-account', access_token: ' ' },
    ],
    ['room binding', { room_calendar_bindings: [{ roomId: 'invalid' }] }],
  ])('fails closed when enabled with invalid %s', (_name, override) => {
    const createTransport = jest.fn<
      RoomReminderMatrixPorts,
      Parameters<RoomReminderTransportFactory>
    >();
    const appConfig = {
      room_reminder_configuration_enabled: true,
      room_reminder_delivery_enabled: false,
      room_calendar_access_enabled: true,
      room_calendar_principal_mode: 'appservice',
      application_service_token: 'server-secret',
      application_service_user_id: '@calendar-bot:example.test',
      homeserver_url: 'https://matrix.example.test',
      radicale_url: 'https://dav.example.test/radicale',
      room_calendar_bindings: [
        { roomId: '!team:example.test', calendarId: 'team-calendar' },
      ],
      ...override,
    } as unknown as IAppConfiguration;

    expect(() =>
      createRoomReminderMatrixPorts(
        appConfig,
        { enabled: true } as RoomReminderStore,
        runtime,
        principalIdentityProvider,
        createTransport,
      ),
    ).toThrow('Room reminder runtime configuration is invalid');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('allows a dynamic-only binding source when static bindings are empty', () => {
    const createTransport = jest.fn<
      RoomReminderMatrixPorts,
      Parameters<RoomReminderTransportFactory>
    >(() => ({
      isRoomEncrypted: jest.fn(),
      getJoinedRoomMembers: jest.fn(),
      getPowerLevels: jest.fn(),
      getRoomVersion: jest.fn(),
      sendRoomMention: jest.fn(),
    }));
    const appConfig = {
      room_reminder_configuration_enabled: true,
      room_reminder_delivery_enabled: false,
      room_calendar_access_enabled: true,
      room_calendar_principal_mode: 'appservice',
      application_service_token: 'server-secret',
      application_service_user_id: '@calendar-bot:example.test',
      homeserver_url: 'https://matrix.example.test',
      radicale_url: 'https://dav.example.test/radicale',
      room_calendar_bindings: [],
    } as unknown as IAppConfiguration;

    expect(
      createRoomReminderMatrixPorts(
        appConfig,
        { enabled: true } as RoomReminderStore,
        runtime,
        principalIdentityProvider,
        createTransport,
      ),
    ).toBeDefined();
    expect(createTransport).toHaveBeenCalledTimes(1);
  });

  it('fails closed when enabled without a reminder database store', () => {
    const createTransport = jest.fn<
      RoomReminderMatrixPorts,
      Parameters<RoomReminderTransportFactory>
    >();
    const appConfig = {
      room_reminder_configuration_enabled: true,
      room_reminder_delivery_enabled: false,
      room_calendar_access_enabled: true,
      room_calendar_principal_mode: 'appservice',
      application_service_token: 'server-secret',
      application_service_user_id: '@calendar-bot:example.test',
      homeserver_url: 'https://matrix.example.test',
      radicale_url: 'https://dav.example.test/radicale',
      room_calendar_bindings: [
        { roomId: '!team:example.test', calendarId: 'team-calendar' },
      ],
    } as unknown as IAppConfiguration;

    expect(() =>
      createRoomReminderMatrixPorts(
        appConfig,
        { enabled: false } as RoomReminderStore,
        runtime,
        principalIdentityProvider,
        createTransport,
      ),
    ).toThrow('Room reminder runtime configuration is invalid');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('creates bot-account reminder ports without application-service credentials or a sender ID', () => {
    const created: RoomReminderMatrixPorts = {
      isRoomEncrypted: jest.fn(),
      getJoinedRoomMembers: jest.fn(),
      getPowerLevels: jest.fn(),
      getRoomVersion: jest.fn(),
      sendRoomMention: jest.fn(),
    };
    const createTransport = jest.fn<
      RoomReminderMatrixPorts,
      Parameters<RoomReminderTransportFactory>
    >(() => created);
    const appConfig = {
      room_reminder_configuration_enabled: true,
      room_reminder_delivery_enabled: false,
      room_calendar_access_enabled: true,
      room_calendar_principal_mode: 'bot-account',
      access_token: 'normal-bot-access-token',
      homeserver_url: 'https://matrix.example.test',
      radicale_url: 'https://dav.example.test/radicale',
      room_calendar_bindings: [
        { roomId: '!team:example.test', calendarId: 'team-calendar' },
      ],
    } as unknown as IAppConfiguration;

    expect(
      createRoomReminderMatrixPorts(
        appConfig,
        { enabled: true } as RoomReminderStore,
        runtime,
        principalIdentityProvider,
        createTransport,
      ),
    ).toBe(created);
    expect(createTransport).toHaveBeenCalledWith(
      {
        mode: 'bot-account',
        homeserverUrl: 'https://matrix.example.test',
        accessToken: 'normal-bot-access-token',
        principalIdentityProvider,
      },
      runtime,
    );
    expect(createTransport.mock.calls[0][0]).not.toHaveProperty(
      'applicationServiceSenderUserId',
    );
  });

  it('wires one default-off transport through services and leaves the lifecycle inert', async () => {
    jest.useFakeTimers();
    const appConfig = {
      room_reminder_configuration_enabled: false,
      room_reminder_delivery_enabled: false,
      room_calendar_principal_mode: 'appservice',
    } as unknown as IAppConfiguration;
    const store = { enabled: false } as RoomReminderStore;
    const roomCalendarAccess = {};
    const eventResources = {};
    const credentials = {};
    const providers = createRoomReminderModuleProviders();
    const factory = <T>(token: unknown): FactoryProvider<T> => {
      const provider = providers.find(({ provide }) => provide === token);
      if (!provider?.useFactory) throw new Error('Provider factory missing');
      return provider as FactoryProvider<T>;
    };

    expect(factory(ConfiguredReminderSchedulerRuntimeSource).inject).toContain(
      ModuleProviderToken.ROOM_CALENDAR_PRINCIPAL_IDENTITY,
    );
    expect(
      factory(ModuleProviderToken.ROOM_REMINDER_MATRIX_PORTS).inject,
    ).toContain(ModuleProviderToken.ROOM_CALENDAR_PRINCIPAL_IDENTITY);

    try {
      const runtime = factory<ConfiguredReminderSchedulerRuntimeSource>(
        ConfiguredReminderSchedulerRuntimeSource,
      ).useFactory(
        appConfig,
        store,
        principalIdentityProvider,
      ) as ConfiguredReminderSchedulerRuntimeSource;
      const getRuntimeConfiguration = jest.spyOn(
        runtime,
        'getCurrentConfiguration',
      );
      const ports = factory<RoomReminderMatrixPorts>(
        ModuleProviderToken.ROOM_REMINDER_MATRIX_PORTS,
      ).useFactory(appConfig, store, runtime, principalIdentityProvider);
      expect(ports).toBe(disabledRoomReminderMatrixPorts);

      const canonical = factory<CanonicalRoomReminderSchedulerSource>(
        CanonicalRoomReminderSchedulerSource,
      ).useFactory(appConfig, roomCalendarAccess, credentials);
      const scheduler = factory<RoomReminderScheduler>(
        RoomReminderScheduler,
      ).useFactory(store, runtime, canonical, ports);
      const configurationService = factory<RoomReminderConfigurationService>(
        RoomReminderConfigurationService,
      ).useFactory(appConfig, store, ports, roomCalendarAccess, eventResources);
      const optionsService = factory<RoomReminderAlarmOptionsService>(
        RoomReminderAlarmOptionsService,
      ).useFactory(configurationService);
      const lifecycle = factory<RoomReminderSchedulerLifecycle>(
        RoomReminderSchedulerLifecycle,
      ).useFactory(
        appConfig,
        store,
        scheduler,
      ) as RoomReminderSchedulerLifecycle;

      const schedulerDependencies = scheduler as unknown as {
        dependencies: { matrixState: RoomReminderMatrixPorts; sender: unknown };
      };
      const configurationDependencies = configurationService as unknown as {
        matrixState: RoomReminderMatrixPorts;
      };
      const optionsDependencies = optionsService as unknown as {
        configurations: RoomReminderConfigurationService;
      };
      expect(schedulerDependencies.dependencies.matrixState).toBe(ports);
      expect(schedulerDependencies.dependencies.sender).toBe(ports);
      expect(configurationDependencies.matrixState).toBe(ports);
      expect(optionsDependencies.configurations).toBe(configurationService);

      lifecycle.onModuleInit();
      await jest.runOnlyPendingTimersAsync();
      expect(jest.getTimerCount()).toBe(0);
      await lifecycle.onModuleDestroy();
      expect(getRuntimeConfiguration).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
