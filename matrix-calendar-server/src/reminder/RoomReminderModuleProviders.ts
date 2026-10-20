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
import { MatrixOpenIdCalDavCredentialProviderFactory } from '../caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import type { RoomCalendarBindingRegistry } from '../service/IRoomCalendarBindingRegistry';
import { validateRoomCalendarBindings } from '../service/RoomCalendarBindingResolver';
import { RoomCalendarCalDavAccess } from '../service/RoomCalendarCalDavAccess';
import { RoomCalendarEventOperations } from '../service/RoomCalendarEventOperations';
import type { RoomCalendarPrincipalIdentityProvider } from '../service/RoomCalendarPrincipalIdentity';
import { CanonicalRoomReminderSchedulerSource } from './CanonicalRoomReminderSchedulerSource';
import { MatrixAppServiceReminderTransport } from './MatrixAppServiceReminderTransport';
import { MatrixBotAccountReminderTransport } from './MatrixBotAccountReminderTransport';
import type { RoomMentionMessage } from './RoomMentionMessage';
import {
  RoomMentionMatrixState,
  RoomMentionPowerLevels,
} from './RoomMentionPolicy';
import { RoomReminderAlarmOptionsService } from './RoomReminderAlarmOptionsService';
import { RoomReminderConfigurationService } from './RoomReminderConfigurationService';
import {
  ReminderSchedulerRuntimeSource,
  ROOM_REMINDER_SCHEDULER_LIMITS,
  RoomReminderScheduler,
  RoomReminderSchedulerSender,
} from './RoomReminderScheduler';
import {
  ConfiguredReminderSchedulerRuntimeSource,
  RoomReminderSchedulerLifecycle,
} from './RoomReminderSchedulerRuntime';
import { RoomReminderStore } from './RoomReminderStore';

export type RoomReminderMatrixPorts = RoomMentionMatrixState &
  RoomReminderSchedulerSender;

export type RoomReminderTransportFactoryOptions =
  | Readonly<{
      mode: 'appservice';
      homeserverUrl: string;
      applicationServiceToken: string;
      applicationServiceSenderUserId: string;
      principalIdentityProvider: RoomCalendarPrincipalIdentityProvider;
    }>
  | Readonly<{
      mode: 'bot-account';
      homeserverUrl: string;
      accessToken: string;
      principalIdentityProvider: RoomCalendarPrincipalIdentityProvider;
    }>;

export type RoomReminderTransportFactory = (
  options: RoomReminderTransportFactoryOptions,
  runtime: ReminderSchedulerRuntimeSource,
) => RoomReminderMatrixPorts;

/**
 * Keep the native appservice transport unconstructed in the default-off
 * configuration. When either reminder feature is enabled, validate every
 * prerequisite before constructing the single shared Matrix state/sender.
 */
export function createRoomReminderMatrixPorts(
  appConfig: IAppConfiguration,
  store: RoomReminderStore,
  runtime: ReminderSchedulerRuntimeSource,
  principalIdentityProvider: RoomCalendarPrincipalIdentityProvider,
  createTransport: RoomReminderTransportFactory = (options, source) =>
    options.mode === 'appservice'
      ? new MatrixAppServiceReminderTransport(options, source)
      : new MatrixBotAccountReminderTransport(options, source),
): RoomReminderMatrixPorts {
  if (
    appConfig.room_reminder_configuration_enabled !== true &&
    appConfig.room_reminder_delivery_enabled !== true
  ) {
    return disabledRoomReminderMatrixPorts;
  }

  if (
    appConfig.room_calendar_access_enabled !== true ||
    store.enabled !== true ||
    (appConfig.room_calendar_principal_mode !== 'appservice' &&
      appConfig.room_calendar_principal_mode !== 'bot-account') ||
    !isSafeBaseUrl(appConfig.homeserver_url) ||
    !isSafeBaseUrl(appConfig.radicale_url) ||
    !hasSupportedBindings(appConfig.room_calendar_bindings)
  ) {
    throw invalidRuntimeConfiguration();
  }

  try {
    if (appConfig.room_calendar_principal_mode === 'appservice') {
      const applicationServiceToken = appConfig.application_service_token;
      const applicationServiceSenderUserId =
        appConfig.application_service_user_id;
      if (
        !isNonEmptyString(applicationServiceToken) ||
        !isNonEmptyString(applicationServiceSenderUserId)
      ) {
        throw invalidRuntimeConfiguration();
      }

      return createTransport(
        {
          mode: 'appservice',
          homeserverUrl: appConfig.homeserver_url,
          applicationServiceToken,
          applicationServiceSenderUserId,
          principalIdentityProvider,
        },
        runtime,
      );
    }

    if (appConfig.room_calendar_principal_mode === 'bot-account') {
      const accessToken = appConfig.access_token;
      if (!isNonEmptyString(accessToken)) {
        throw invalidRuntimeConfiguration();
      }

      return createTransport(
        {
          mode: 'bot-account',
          homeserverUrl: appConfig.homeserver_url,
          accessToken,
          principalIdentityProvider,
        },
        runtime,
      );
    }

    throw invalidRuntimeConfiguration();
  } catch {
    throw invalidRuntimeConfiguration();
  }
}

export class DisabledRoomReminderMatrixPorts implements RoomReminderMatrixPorts {
  async isRoomEncrypted(
    _roomId: string,
    _signal?: AbortSignal,
  ): Promise<boolean> {
    throw integrationDisabled();
  }

  async getJoinedRoomMembers(
    _roomId: string,
    _signal?: AbortSignal,
  ): Promise<readonly string[]> {
    throw integrationDisabled();
  }

  async getPowerLevels(
    _roomId: string,
    _signal?: AbortSignal,
  ): Promise<RoomMentionPowerLevels | undefined> {
    throw integrationDisabled();
  }

  async getRoomVersion(
    _roomId: string,
    _signal?: AbortSignal,
  ): Promise<string | undefined> {
    throw integrationDisabled();
  }

  async sendRoomMention(
    _roomId: string,
    _calendarId: string,
    _message: RoomMentionMessage,
    _transactionId: string,
    _signal: AbortSignal,
  ): Promise<void> {
    throw integrationDisabled();
  }
}

export const disabledRoomReminderMatrixPorts =
  new DisabledRoomReminderMatrixPorts();

export function createRoomReminderModuleProviders(): FactoryProvider[] {
  return [
    {
      provide: ConfiguredReminderSchedulerRuntimeSource,
      useFactory: (
        appConfig: IAppConfiguration,
        store: RoomReminderStore,
        principalIdentityProvider: RoomCalendarPrincipalIdentityProvider,
        bindingRegistry: RoomCalendarBindingRegistry,
      ) =>
        new ConfiguredReminderSchedulerRuntimeSource(
          appConfig,
          store,
          principalIdentityProvider,
          bindingRegistry,
        ),
      inject: [
        ModuleProviderToken.APP_CONFIGURATION,
        ModuleProviderToken.ROOM_REMINDER_STORE,
        ModuleProviderToken.ROOM_CALENDAR_PRINCIPAL_IDENTITY,
        ModuleProviderToken.ROOM_CALENDAR_BINDING_REGISTRY,
      ],
    },
    {
      provide: ModuleProviderToken.ROOM_REMINDER_MATRIX_PORTS,
      useFactory: (
        appConfig: IAppConfiguration,
        store: RoomReminderStore,
        runtime: ConfiguredReminderSchedulerRuntimeSource,
        principalIdentityProvider: RoomCalendarPrincipalIdentityProvider,
      ) =>
        createRoomReminderMatrixPorts(
          appConfig,
          store,
          runtime,
          principalIdentityProvider,
        ),
      inject: [
        ModuleProviderToken.APP_CONFIGURATION,
        ModuleProviderToken.ROOM_REMINDER_STORE,
        ConfiguredReminderSchedulerRuntimeSource,
        ModuleProviderToken.ROOM_CALENDAR_PRINCIPAL_IDENTITY,
      ],
    },
    {
      provide: CanonicalRoomReminderSchedulerSource,
      useFactory: (
        appConfig: IAppConfiguration,
        roomCalendarAccess: RoomCalendarCalDavAccess,
        credentials: MatrixOpenIdCalDavCredentialProviderFactory,
      ) =>
        new CanonicalRoomReminderSchedulerSource(
          appConfig,
          roomCalendarAccess,
          credentials,
        ),
      inject: [
        ModuleProviderToken.APP_CONFIGURATION,
        ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS,
        MatrixOpenIdCalDavCredentialProviderFactory,
      ],
    },
    {
      provide: RoomReminderScheduler,
      useFactory: (
        store: RoomReminderStore,
        runtime: ConfiguredReminderSchedulerRuntimeSource,
        canonical: CanonicalRoomReminderSchedulerSource,
        matrix: RoomReminderMatrixPorts,
      ) =>
        new RoomReminderScheduler({
          store,
          runtime,
          canonical,
          matrixState: matrix,
          sender: matrix,
        }),
      inject: [
        ModuleProviderToken.ROOM_REMINDER_STORE,
        ConfiguredReminderSchedulerRuntimeSource,
        CanonicalRoomReminderSchedulerSource,
        ModuleProviderToken.ROOM_REMINDER_MATRIX_PORTS,
      ],
    },
    {
      provide: RoomReminderSchedulerLifecycle,
      useFactory: (
        appConfig: IAppConfiguration,
        store: RoomReminderStore,
        scheduler: RoomReminderScheduler,
      ) => new RoomReminderSchedulerLifecycle(appConfig, store, scheduler),
      inject: [
        ModuleProviderToken.APP_CONFIGURATION,
        ModuleProviderToken.ROOM_REMINDER_STORE,
        RoomReminderScheduler,
      ],
    },
    {
      provide: RoomReminderConfigurationService,
      useFactory: (
        appConfig: IAppConfiguration,
        store: RoomReminderStore,
        matrix: RoomReminderMatrixPorts,
        roomCalendarAccess: RoomCalendarCalDavAccess,
        eventResources: RoomCalendarEventOperations,
        bindingRegistry: RoomCalendarBindingRegistry,
      ) =>
        new RoomReminderConfigurationService(
          appConfig,
          store,
          matrix,
          roomCalendarAccess,
          eventResources,
          bindingRegistry,
        ),
      inject: [
        ModuleProviderToken.APP_CONFIGURATION,
        ModuleProviderToken.ROOM_REMINDER_STORE,
        ModuleProviderToken.ROOM_REMINDER_MATRIX_PORTS,
        ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS,
        RoomCalendarEventOperations,
        ModuleProviderToken.ROOM_CALENDAR_BINDING_REGISTRY,
      ],
    },
    {
      provide: RoomReminderAlarmOptionsService,
      useFactory: (configurations: RoomReminderConfigurationService) =>
        new RoomReminderAlarmOptionsService(configurations),
      inject: [RoomReminderConfigurationService],
    },
  ];
}

function hasSupportedBindings(bindings: unknown): boolean {
  try {
    const validated = validateRoomCalendarBindings(bindings);
    return (
      validated.length <= ROOM_REMINDER_SCHEDULER_LIMITS.maxBindingsPerRun
    );
  } catch {
    return false;
  }
}

function isSafeBaseUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function integrationDisabled(): Error {
  return new Error('Room reminder integrations are disabled');
}

function invalidRuntimeConfiguration(): Error {
  return new Error('Room reminder runtime configuration is invalid');
}
