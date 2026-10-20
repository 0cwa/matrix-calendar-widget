/*
 * Copyright 2022 Nordeck IT + Consulting GmbH
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

import { FactoryProvider, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import i18next from 'i18next';
import i18nextFsBackend from 'i18next-fs-backend';
import i18nextMiddleware from 'i18next-http-middleware';
import {
  ICryptoStorageProvider,
  IStorageProvider,
  MatrixClient,
  RustSdkCryptoStorageProvider,
  SimpleFsStorageProvider,
  UserID,
} from 'matrix-bot-sdk';
import { LoggerModule } from 'nestjs-pino';
import path from 'path';
import postgres from 'postgres';
import { v4 as uuiv4 } from 'uuid';
import { AppRuntimeContext } from './AppRuntimeContext';
import { MatrixOpenIdCalDavCredentialProviderFactory } from './caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import { JitsiClient } from './client/JitsiClient';
import { MatrixClientAdapter } from './client/MatrixClientAdapter';
import { MeetingClient } from './client/MeetingClient';
import { ReactionClient } from './client/ReactionClient';
import { WidgetClient } from './client/WidgetClient';
import configuration, { ValidationSchema } from './configuration';
import { CalendarGatewayController } from './controller/CalendarGatewayController';
import { CommandController } from './controller/CommandController';
import { ConfigurationController } from './controller/ConfigurationController';
import { GuestMemberController } from './controller/GuestMemberController';
import { HealthCheckController } from './controller/HealthCheckController';
import { MeetingController } from './controller/MeetingController';
import { RoomReminderAlarmOptionsController } from './controller/RoomReminderAlarmOptionsController';
import { RoomReminderConfigurationController } from './controller/RoomReminderConfigurationController';
import { WelcomeWorkflowController } from './controller/WelcomeWorkflowController';
import { WidgetController } from './controller/WidgetController';
import { registerDateRangeFormatter } from './dateRangeFormatter';
import { EventContentRenderer } from './EventContentRenderer';
import { LegacyMeetingDisabledGuard } from './guard/LegacyMeetingDisabledGuard';
import { IAppConfiguration } from './IAppConfiguration';
import { RoomMatrixEventsReader } from './io/RoomMatrixEventsReader';
import { WidgetLayoutConfigReader } from './io/WidgetLayoutConfigReader';
import { MatrixClientProxyHandler } from './matrix/MatrixClientProxyHandler';
import {
  AutojoinRoomsMixin,
  AutojoinUpgradedRoomsMixin,
} from './matrix/mixins';
import { MatrixAuthMiddleware } from './middleware/MatrixAuthMiddleware';
import { IRoomMatrixEvents } from './model/IRoomMatrixEvents';
import { ModuleProviderToken } from './ModuleProviderToken';
import {
  DisabledRoomReminderStore,
  PostgresRoomReminderStore,
  RoomReminderStore,
} from './reminder';
import {
  getPostgresDatabaseTlsOptions,
  getReminderDatabaseTlsOptions,
} from './reminder/ReminderDatabaseConnection';
import { createRoomReminderModuleProviders } from './reminder/RoomReminderModuleProviders';
import { MatrixServer } from './rpc/MatrixServer';
import { CalendarCommandService } from './service/CalendarCommandService';
import { CommandService } from './service/CommandService';
import { ConfiguredRoomCalendarPrincipalIdentityProvider } from './service/ConfiguredRoomCalendarPrincipalIdentityProvider';
import { ControlRoomMigrationService } from './service/ControlRoomMigrationService';
import { GuestMemberService } from './service/GuestMemberService';
import { MatrixCalendarAuthorizationFactory } from './service/MatrixCalendarAuthorization';
import { MeetingService } from './service/MeetingService';
import { RoomCalendarCalDavAccess } from './service/RoomCalendarCalDavAccess';
import { DisabledRoomCalendarBindingStore } from './service/DisabledRoomCalendarBindingStore';
import { PostgresRoomCalendarBindingStore } from './service/PostgresRoomCalendarBindingStore';
import { RoomCalendarBindingRegistryAdapter } from './service/RoomCalendarBindingRegistryAdapter';
import { MatrixRoomCalendarPrincipalOpenIdProofProvider } from './service/RoomCalendarPrincipalOpenIdProofProvider';
import { RoomCalendarSetupCalDavProvisioner } from './service/RoomCalendarSetupCalDavProvisioner';
import { MatrixRoomCalendarSetupService } from './service/RoomCalendarSetupService';
import { RoomCalendarSetupWidgetInstaller } from './service/RoomCalendarSetupWidgetInstaller';
import { RoomCalendarEventAuditService } from './service/RoomCalendarEventAuditService';
import { RoomCalendarEventOperations } from './service/RoomCalendarEventOperations';
import type { RoomCalendarPrincipalIdentityProvider } from './service/RoomCalendarPrincipalIdentity';
import type { RoomCalendarPrincipalOpenIdProofPort } from './service/RoomCalendarPrincipalOpenIdProofProvider';
import type { RoomCalendarBindingStore } from './model/IRoomCalendarBindingStore';
import type { RoomCalendarBindingRegistry } from './service/IRoomCalendarBindingRegistry';
import { RoomMessageService } from './service/RoomMessageService';
import { WelcomeWorkflowService } from './service/WelcomeWorkflowService';
import { WidgetLayoutService } from './service/WidgetLayoutService';
import { DoesWidgetWithIdExistConstraint } from './validator/DoesWidgetWithIdExist';

const logger = new Logger('app.module');
const appControllers = [
  CalendarGatewayController,
  CommandController,
  ConfigurationController,
  HealthCheckController,
  MeetingController,
  RoomReminderConfigurationController,
  RoomReminderAlarmOptionsController,
  WelcomeWorkflowController,
  WidgetController,
  GuestMemberController,
];

const appConfigurationFactory: FactoryProvider<IAppConfiguration> = {
  provide: ModuleProviderToken.APP_CONFIGURATION,
  useFactory: (configService: ConfigService) => {
    const appConfiguration = configService.get<IAppConfiguration>('config');
    if (appConfiguration) {
      return appConfiguration;
    } else {
      throw new Error('Cannot load configuration');
    }
  },
  inject: [ConfigService],
};

const roomMatrixEventsFactory: FactoryProvider<IRoomMatrixEvents> = {
  provide: ModuleProviderToken.ROOM_MATRIX_EVENTS,
  useFactory: (appConfiguration: IAppConfiguration) => {
    return new RoomMatrixEventsReader(
      appConfiguration.default_events_config,
    ).read();
  },
  inject: [ModuleProviderToken.APP_CONFIGURATION],
};

const widgetLayoutConfigFactory: FactoryProvider = {
  provide: ModuleProviderToken.WIDGET_LAYOUTS,
  useFactory: (appConfiguration: IAppConfiguration) => {
    return new WidgetLayoutConfigReader(
      appConfiguration.default_widget_layouts_config,
    ).read();
  },
  inject: [ModuleProviderToken.APP_CONFIGURATION],
};

const roomReminderStoreFactory: FactoryProvider<Promise<RoomReminderStore>> = {
  provide: ModuleProviderToken.ROOM_REMINDER_STORE,
  useFactory: async (appConfig: IAppConfiguration) => {
    if (!appConfig.reminder_database_url) {
      return new DisabledRoomReminderStore();
    }

    // Postgres.js 3.4.5 supports host/port arrays at runtime for single IP
    // endpoints, although its public Options type omits those arrays.
    const postgresOptions = {
      ...getReminderDatabaseTlsOptions(
        appConfig.reminder_database_tls_mode ?? 'verify-full',
        appConfig.reminder_database_url,
      ),
      max: 5,
      connect_timeout: 5,
      idle_timeout: 20,
      connection: { application_name: 'matrix-calendar-reminders' },
    } as unknown as Parameters<typeof postgres>[1];
    const sql = postgres(appConfig.reminder_database_url, postgresOptions);
    const store = new PostgresRoomReminderStore(sql);
    try {
      await store.migrate();
      return store;
    } catch (error) {
      await store.onApplicationShutdown();
      throw error;
    }
  },
  inject: [ModuleProviderToken.APP_CONFIGURATION],
};

const roomCalendarBindingStoreFactory: FactoryProvider<
  Promise<RoomCalendarBindingStore>
> = {
  provide: ModuleProviderToken.ROOM_CALENDAR_BINDING_STORE,
  useFactory: async (appConfig: IAppConfiguration) => {
    if (!appConfig.room_calendar_binding_database_url) {
      return new DisabledRoomCalendarBindingStore();
    }

    const postgresOptions = {
      ...getPostgresDatabaseTlsOptions(
        appConfig.room_calendar_binding_database_tls_mode,
        appConfig.room_calendar_binding_database_url,
      ),
      max: 3,
      connect_timeout: 5,
      idle_timeout: 20,
      connection: {
        application_name: 'matrix-calendar-bindings',
        // Postgres.js passes startup runtime settings in milliseconds.
        statement_timeout: 5_000,
      },
    } as unknown as Parameters<typeof postgres>[1];
    const sql = postgres(
      appConfig.room_calendar_binding_database_url,
      postgresOptions,
    );
    const store = new PostgresRoomCalendarBindingStore(sql);
    try {
      await store.migrate();
      return store;
    } catch (error) {
      await store.onApplicationShutdown();
      throw error;
    }
  },
  inject: [ModuleProviderToken.APP_CONFIGURATION],
};

const roomCalendarBindingRegistryFactory: FactoryProvider<RoomCalendarBindingRegistry> = {
  provide: ModuleProviderToken.ROOM_CALENDAR_BINDING_REGISTRY,
  useFactory: (
    appConfig: IAppConfiguration,
    store: RoomCalendarBindingStore,
  ) => new RoomCalendarBindingRegistryAdapter(appConfig.room_calendar_bindings, store),
  inject: [
    ModuleProviderToken.APP_CONFIGURATION,
    ModuleProviderToken.ROOM_CALENDAR_BINDING_STORE,
  ],
};

const matrixClientFactoryHelper = {
  createStorageProvider: async (
    appConfig: IAppConfiguration,
  ): Promise<IStorageProvider> => {
    const storage = new SimpleFsStorageProvider(
      path.join(appConfig.data_path, appConfig.data_filename),
    );

    logger.log(
      `createStorageProvider.filepath: ${appConfig.data_path}/${appConfig.data_filename}`,
    );

    return storage;
  },

  createCryptoStorageProvider: async (
    appConfig: IAppConfiguration,
  ): Promise<ICryptoStorageProvider> => {
    const cryptoStorage = new RustSdkCryptoStorageProvider(
      path.join(appConfig.data_path, appConfig.crypto_data_path),
    );

    logger.log(
      `createCryptoStorageProvider.filepath: ${appConfig.data_path}/${appConfig.crypto_data_path}`,
    );

    return cryptoStorage;
  },

  getServer: (appConfig: IAppConfiguration) => ({
    accessToken: appConfig.access_token,
    url: appConfig.homeserver_url,
  }),
};

const matrixClientFactory: FactoryProvider<Promise<MatrixClient>> = {
  provide: MatrixClient,
  useFactory: async (appConfig: IAppConfiguration): Promise<MatrixClient> => {
    const storage: IStorageProvider =
      await matrixClientFactoryHelper.createStorageProvider(appConfig);

    let cryptoStorage: ICryptoStorageProvider | undefined = undefined;

    if (appConfig.enable_crypto) {
      cryptoStorage =
        await matrixClientFactoryHelper.createCryptoStorageProvider(appConfig);
    }

    // create server object
    const server = matrixClientFactoryHelper.getServer(appConfig);
    // create matrix client
    const client = new MatrixClient(
      server.url,
      server.accessToken,
      storage,
      cryptoStorage,
    );

    // the 'room.archived' event listeners
    AutojoinUpgradedRoomsMixin.setupOnClient(client);

    // if we don't use the welcome service, then setup the autojoin mixin from the bot SDK
    if (!appConfig.enable_welcome_workflow) {
      AutojoinRoomsMixin.setupOnClient(client);
      logger.log('Welcome Workflow is disabled ');
    }

    return new Proxy<MatrixClient>(client, new MatrixClientProxyHandler());
  },
  inject: [ModuleProviderToken.APP_CONFIGURATION],
};

const appRuntimeContextFactory: FactoryProvider<Promise<AppRuntimeContext>> = {
  provide: AppRuntimeContext,
  useFactory: async (client: MatrixClient): Promise<AppRuntimeContext> => {
    const userId = await client.getUserId();
    const localpart = new UserID(userId).localpart;

    let displayName;
    try {
      const profile = await client.getUserProfile(userId);
      if (profile?.membershipEventContent.displayname) {
        displayName = profile.membershipEventContent.displayname;
      } else {
        displayName = localpart; // for sanity
      }
    } catch (_err) {
      displayName = localpart;
    }
    return new AppRuntimeContext(userId, displayName, localpart, ['en', 'de']);
  },
  inject: [MatrixClient],
};

const i18nFactory: FactoryProvider<void> = {
  provide: ModuleProviderToken.I18N,
  useFactory: (appRuntimeContext: AppRuntimeContext): void => {
    i18next
      .use(i18nextFsBackend)
      .use(i18nextMiddleware.LanguageDetector)
      .init({
        fallbackLng: 'en',
        backend: {
          loadPath: `${__dirname}/static/locales/{{lng}}/{{ns}}.json`,
        },
        debug: false,
        saveMissing: true,
        detection: {
          order: ['header', 'querystring', 'cookie'],
          caches: ['cookie'],
        },
        preload: appRuntimeContext.supportedLngs,
      });
    registerDateRangeFormatter(i18next);
  },
  inject: [AppRuntimeContext],
};

@Module({
  imports: [
    ConfigModule.forRoot({
      validationSchema: ValidationSchema,
      envFilePath: ['.env.local', '.env.dev', '.env'],
      load: [configuration],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'error',
        genReqId(_req) {
          return uuiv4();
        },
        redact: ['req.headers.authorization', 'matrix_event.content'],
      },
    }),
  ],
  controllers: appControllers,

  providers: [
    appConfigurationFactory,
    roomReminderStoreFactory,
    roomCalendarBindingStoreFactory,
    roomCalendarBindingRegistryFactory,
    ...createRoomReminderModuleProviders(),
    roomMatrixEventsFactory,
    widgetLayoutConfigFactory,
    matrixClientFactory,
    appRuntimeContextFactory,
    {
      provide: ModuleProviderToken.ROOM_CALENDAR_PRINCIPAL_IDENTITY,
      useFactory: (
        appConfig: IAppConfiguration,
        matrixClient: MatrixClient,
        appRuntimeContext: AppRuntimeContext,
      ) =>
        new ConfiguredRoomCalendarPrincipalIdentityProvider(
          appConfig,
          matrixClient,
          appRuntimeContext,
        ),
      inject: [
        ModuleProviderToken.APP_CONFIGURATION,
        MatrixClient,
        AppRuntimeContext,
      ],
    },
    {
      provide: ModuleProviderToken.ROOM_CALENDAR_PRINCIPAL_OPENID_PROOF_PROVIDER,
      useFactory: (
        appConfig: IAppConfiguration,
        principalIdentityProvider: RoomCalendarPrincipalIdentityProvider,
        nativeFetch: typeof fetch,
      ) =>
        new MatrixRoomCalendarPrincipalOpenIdProofProvider(
          appConfig,
          principalIdentityProvider,
          nativeFetch,
        ),
      inject: [
        ModuleProviderToken.APP_CONFIGURATION,
        ModuleProviderToken.ROOM_CALENDAR_PRINCIPAL_IDENTITY,
        ModuleProviderToken.NATIVE_FETCH,
      ],
    },
    {
      provide: ModuleProviderToken.ROOM_CALENDAR_SETUP_CALDAV_PROVISIONER,
      useFactory: (
        appConfig: IAppConfiguration,
        proofProvider: RoomCalendarPrincipalOpenIdProofPort,
        nativeFetch: typeof fetch,
      ) =>
        new RoomCalendarSetupCalDavProvisioner(
          appConfig.radicale_url,
          proofProvider,
          nativeFetch,
        ),
      inject: [
        ModuleProviderToken.APP_CONFIGURATION,
        ModuleProviderToken.ROOM_CALENDAR_PRINCIPAL_OPENID_PROOF_PROVIDER,
        ModuleProviderToken.NATIVE_FETCH,
      ],
    },
    {
      provide: ModuleProviderToken.ROOM_CALENDAR_SETUP_WIDGET_INSTALLER,
      useFactory: (
        matrixClient: MatrixClient,
        widgetClient: WidgetClient,
        appConfig: IAppConfiguration,
      ) =>
        new RoomCalendarSetupWidgetInstaller(
          matrixClient,
          widgetClient,
          appConfig.meetingwidget_url,
        ),
      inject: [
        MatrixClient,
        WidgetClient,
        ModuleProviderToken.APP_CONFIGURATION,
      ],
    },
    {
      provide: ModuleProviderToken.ROOM_CALENDAR_SETUP_SERVICE,
      useFactory: (
        appConfig: IAppConfiguration,
        authorizationFactory: MatrixCalendarAuthorizationFactory,
        matrixClient: MatrixClient,
        appRuntimeContext: AppRuntimeContext,
        registry: RoomCalendarBindingRegistry,
        bindingStore: RoomCalendarBindingStore,
        caldavProvisioner: RoomCalendarSetupCalDavProvisioner,
        widgetInstaller: RoomCalendarSetupWidgetInstaller,
      ) =>
        new MatrixRoomCalendarSetupService(
          {
            enabled: appConfig.room_calendar_setup_enabled,
            staticBindings: appConfig.room_calendar_bindings,
            allowedActorServerNames:
              appConfig.room_calendar_setup_allowed_actor_server_names,
          },
          authorizationFactory,
          matrixClient,
          appRuntimeContext.botUserId,
          registry,
          bindingStore,
          caldavProvisioner,
          widgetInstaller,
        ),
      inject: [
        ModuleProviderToken.APP_CONFIGURATION,
        MatrixCalendarAuthorizationFactory,
        MatrixClient,
        AppRuntimeContext,
        ModuleProviderToken.ROOM_CALENDAR_BINDING_REGISTRY,
        ModuleProviderToken.ROOM_CALENDAR_BINDING_STORE,
        ModuleProviderToken.ROOM_CALENDAR_SETUP_CALDAV_PROVISIONER,
        ModuleProviderToken.ROOM_CALENDAR_SETUP_WIDGET_INSTALLER,
      ],
    },
    i18nFactory,
    EventContentRenderer,
    JitsiClient,
    MeetingClient,
    MatrixCalendarAuthorizationFactory,
    MatrixAuthMiddleware,
    LegacyMeetingDisabledGuard,
    {
      provide: ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS,
      useFactory: (
        appConfig: IAppConfiguration,
        bindingRegistry: RoomCalendarBindingRegistry,
        proofProvider: RoomCalendarPrincipalOpenIdProofPort,
      ) =>
        new RoomCalendarCalDavAccess(appConfig, bindingRegistry, proofProvider),
      inject: [
        ModuleProviderToken.APP_CONFIGURATION,
        ModuleProviderToken.ROOM_CALENDAR_BINDING_REGISTRY,
        ModuleProviderToken.ROOM_CALENDAR_PRINCIPAL_OPENID_PROOF_PROVIDER,
      ],
    },
    {
      provide: ModuleProviderToken.NATIVE_FETCH,
      useValue: fetch,
    },
    {
      provide: RoomCalendarEventOperations,
      useFactory: (
        appConfig: IAppConfiguration,
        principalIdentityProvider: RoomCalendarPrincipalIdentityProvider,
        bindingRegistry: RoomCalendarBindingRegistry,
      ) =>
        new RoomCalendarEventOperations(fetch, {
          eventWritesEnabled: appConfig.room_calendar_event_writes_enabled,
          maxResponseBytes: appConfig.caldav_max_event_response_bytes,
          radicaleBaseUrl: appConfig.radicale_url,
          bindingRegistry,
          principalIdentityProvider,
        }),
      inject: [
        ModuleProviderToken.APP_CONFIGURATION,
        ModuleProviderToken.ROOM_CALENDAR_PRINCIPAL_IDENTITY,
        ModuleProviderToken.ROOM_CALENDAR_BINDING_REGISTRY,
      ],
    },
    {
      provide: RoomCalendarEventAuditService,
      useFactory: (
        matrixClient: MatrixClient,
        appConfig: IAppConfiguration,
        bindingRegistry: RoomCalendarBindingRegistry,
      ) =>
        new RoomCalendarEventAuditService(matrixClient, {
          enabled: appConfig.room_calendar_action_messages_enabled,
          bindingRegistry,
          encryptionEnabled: appConfig.enable_crypto,
        }),
      inject: [
        MatrixClient,
        ModuleProviderToken.APP_CONFIGURATION,
        ModuleProviderToken.ROOM_CALENDAR_BINDING_REGISTRY,
      ],
    },
    {
      provide: CalendarCommandService,
      useFactory: (
        appConfig: IAppConfiguration,
        authorizationFactory: MatrixCalendarAuthorizationFactory,
        roomCalendarAccess: RoomCalendarCalDavAccess,
        eventOperations: RoomCalendarEventOperations,
        bindingRegistry: RoomCalendarBindingRegistry,
      ) =>
        new CalendarCommandService(
          appConfig,
          authorizationFactory,
          roomCalendarAccess,
          eventOperations,
          bindingRegistry,
        ),
      inject: [
        ModuleProviderToken.APP_CONFIGURATION,
        MatrixCalendarAuthorizationFactory,
        ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS,
        RoomCalendarEventOperations,
        ModuleProviderToken.ROOM_CALENDAR_BINDING_REGISTRY,
      ],
    },
    MatrixOpenIdCalDavCredentialProviderFactory,
    MatrixClientAdapter,
    ReactionClient,
    WidgetClient,
    CommandService,
    MeetingService,
    RoomMessageService,
    WelcomeWorkflowService,
    ControlRoomMigrationService,
    WidgetLayoutService,
    MatrixServer,
    DoesWidgetWithIdExistConstraint,
    GuestMemberService,
  ],
})
export class AppModule {}
