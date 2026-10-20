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

import { MatrixError } from 'matrix-bot-sdk';
import { Matrix404Error } from '../error/Matrix404Error';
import type { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import type {
  RoomCalendarBindingRecord,
  RoomCalendarBindingStore,
} from '../model/IRoomCalendarBindingStore';
import type { RoomCalendarBindingRegistry } from './IRoomCalendarBindingRegistry';
import type {
  RoomCalendarSetupAuthorizationPort,
  RoomCalendarSetupCalDavPort,
  RoomCalendarSetupMatrixPreconditionsPort,
  RoomCalendarSetupWidgetPort,
} from './RoomCalendarSetupPorts';
import { MatrixRoomCalendarSetupService } from './RoomCalendarSetupService';

const ROOM_ID = '!moderated:matrix.org';
const ACTOR_ID = '@moderator:matrix.org';
const BOT_ID = '@calendar:matrix.org';
const UUID = '00000000-0000-4000-8000-000000000001';
const RETRY_BINDING = {
  roomId: ROOM_ID,
  calendarId: 'calendar-00000000-0000-4000-8000-000000000002',
};
const DYNAMIC_BINDING = {
  roomId: ROOM_ID,
  calendarId: `calendar-${UUID}`,
};
const STATIC_BINDING = { roomId: ROOM_ID, calendarId: 'legacy-calendar' };

function makeReadyRecord(
  binding: RoomCalendarBinding,
): RoomCalendarBindingRecord {
  const now = new Date('2026-10-20T12:00:00Z');
  return {
    ...binding,
    status: 'ready',
    createdBy: ACTOR_ID,
    createdAt: now,
    readyAt: now,
  };
}

function makePendingRecord(
  binding: RoomCalendarBinding,
): RoomCalendarBindingRecord {
  return {
    ...binding,
    status: 'pending',
    createdBy: ACTOR_ID,
    createdAt: new Date('2026-10-20T12:00:00Z'),
  };
}

function makeHarness(options?: {
  enabled?: boolean;
  storeEnabled?: boolean;
  staticBindings?: readonly RoomCalendarBinding[];
  allowedActorServerNames?: readonly string[];
  snapshot?: readonly RoomCalendarBinding[];
  reserveKind?: 'reserved' | 'existing' | 'capacity-reached';
  record?: RoomCalendarBindingRecord;
  caldavOutcome?: 'created' | 'existing' | 'missing' | 'conflict';
  caldavFailure?: boolean;
  widgetOutcome?: 'installed' | 'already-present' | 'conflict' | 'unavailable';
  widgetPreflightOutcome?: 'ready' | 'conflict' | 'unavailable';
  widgetFailure?: boolean;
  manager?: boolean;
  joinedMembers?: readonly string[];
  encryptionLookup?: () => Promise<unknown>;
  powerLevels?: unknown;
  roomState?: unknown;
  registryFailure?: boolean;
}) {
  const configuration = {
    enabled: options?.enabled ?? true,
    staticBindings: options?.staticBindings ?? [],
    allowedActorServerNames: options?.allowedActorServerNames,
  };
  const authorization: RoomCalendarSetupAuthorizationPort = {
    canManageCalendars: jest.fn().mockResolvedValue(options?.manager ?? true),
  };
  const matrixClient: RoomCalendarSetupMatrixPreconditionsPort = {
    getJoinedRoomMembers: jest
      .fn()
      .mockResolvedValue(options?.joinedMembers ?? [BOT_ID]),
    getRoomState: jest.fn().mockResolvedValue(options?.roomState ?? []),
    getRoomStateEvent: jest.fn(async (_roomId, eventType) => {
      if (eventType === 'm.room.encryption') {
        if (options?.encryptionLookup) {
          return options.encryptionLookup();
        }
        throw new MatrixError(
          { errcode: 'M_NOT_FOUND', error: 'missing state' },
          404,
        );
      }
      return (
        options?.powerLevels ?? {
          events_default: 0,
          state_default: 50,
          users: { [BOT_ID]: 100 },
        }
      );
    }),
  };
  const registry: RoomCalendarBindingRegistry = {
    getSnapshot: jest.fn(async () => {
      if (options?.registryFailure) throw new Error('store unavailable');
      return options?.snapshot ?? [];
    }),
    resolve: jest.fn(),
  };
  const record = options?.record ?? makePendingRecord(DYNAMIC_BINDING);
  const bindingStore: RoomCalendarBindingStore = {
    enabled: options?.storeEnabled ?? true,
    listAll: jest.fn().mockResolvedValue([]),
    reserve: jest.fn().mockImplementation(async () => {
      if (options?.reserveKind === 'capacity-reached') {
        return { kind: 'capacity-reached' };
      }
      return {
        kind: options?.reserveKind ?? 'reserved',
        record,
      };
    }),
    markReady: jest
      .fn()
      .mockImplementation(async (binding: RoomCalendarBinding) =>
        makeReadyRecord(binding),
      ),
  };
  const caldav: RoomCalendarSetupCalDavPort = {
    reconcile: options?.caldavFailure
      ? jest.fn().mockRejectedValue(new Error('CalDAV home mismatch'))
      : jest.fn().mockResolvedValue(options?.caldavOutcome ?? 'created'),
  };
  const installWidget = jest.fn();
  if (options?.widgetFailure) {
    installWidget.mockRejectedValue(new Error('Matrix write failed'));
  } else {
    installWidget.mockResolvedValue(options?.widgetOutcome ?? 'installed');
  }
  const widget: RoomCalendarSetupWidgetPort = {
    preflight: jest
      .fn()
      .mockResolvedValue(options?.widgetPreflightOutcome ?? 'ready'),
    install: installWidget,
  };
  const service = new MatrixRoomCalendarSetupService(
    configuration,
    authorization,
    matrixClient,
    BOT_ID,
    registry,
    bindingStore,
    caldav,
    widget,
    () => UUID,
  );

  return {
    service,
    authorization,
    matrixClient,
    registry,
    bindingStore,
    caldav,
    widget,
  };
}

const setupRequest = { roomId: ROOM_ID, actorUserId: ACTOR_ID };

describe('MatrixRoomCalendarSetupService', () => {
  test('disabled setup stops before authorization or Matrix and persistence work', async () => {
    const harness = makeHarness({ enabled: false });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'disabled',
    });

    expect(harness.authorization.canManageCalendars).not.toHaveBeenCalled();
    expect(harness.matrixClient.getRoomStateEvent).not.toHaveBeenCalled();
    expect(harness.registry.getSnapshot).not.toHaveBeenCalled();
    expect(harness.bindingStore.reserve).not.toHaveBeenCalled();
    expect(harness.caldav.reconcile).not.toHaveBeenCalled();
    expect(harness.widget.preflight).not.toHaveBeenCalled();
    expect(harness.widget.install).not.toHaveBeenCalled();
  });

  test.each([
    ['an incomplete widget URL', 'unavailable'],
    ['an uncertain existing widget', 'conflict'],
  ] as const)(
    '%s stops before binding-store or CalDAV work',
    async (_name, widgetPreflightOutcome) => {
      const harness = makeHarness({ widgetPreflightOutcome });

      await expect(harness.service.setup(setupRequest)).resolves.toEqual({
        status: widgetPreflightOutcome,
      });

      expect(harness.registry.getSnapshot).not.toHaveBeenCalled();
      expect(harness.bindingStore.reserve).not.toHaveBeenCalled();
      expect(harness.caldav.reconcile).not.toHaveBeenCalled();
      expect(harness.widget.install).not.toHaveBeenCalled();
    },
  );

  test('a non-manager is denied before encryption, database, OpenID, or CalDAV work', async () => {
    const harness = makeHarness({ manager: false });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'not-authorized',
    });

    expect(harness.matrixClient.getRoomStateEvent).not.toHaveBeenCalled();
    expect(harness.matrixClient.getJoinedRoomMembers).not.toHaveBeenCalled();
    expect(harness.registry.getSnapshot).not.toHaveBeenCalled();
    expect(harness.bindingStore.reserve).not.toHaveBeenCalled();
    expect(harness.caldav.reconcile).not.toHaveBeenCalled();
  });

  test('a federated moderator is denied by default before manager or setup work', async () => {
    const harness = makeHarness();

    await expect(
      harness.service.setup({
        roomId: ROOM_ID,
        actorUserId: '@moderator:remote.example',
      }),
    ).resolves.toEqual({ status: 'not-authorized' });

    expect(harness.authorization.canManageCalendars).not.toHaveBeenCalled();
    expect(harness.matrixClient.getRoomStateEvent).not.toHaveBeenCalled();
    expect(harness.registry.getSnapshot).not.toHaveBeenCalled();
    expect(harness.bindingStore.reserve).not.toHaveBeenCalled();
    expect(harness.caldav.reconcile).not.toHaveBeenCalled();
  });

  test('an explicit server allowlist admits a federated manager but does not replace room authorization', async () => {
    const harness = makeHarness({
      allowedActorServerNames: ['remote.example'],
    });
    const request = {
      roomId: ROOM_ID,
      actorUserId: '@moderator:remote.example',
    };

    await expect(harness.service.setup(request)).resolves.toEqual({
      status: 'created',
    });
    expect(harness.authorization.canManageCalendars).toHaveBeenCalledWith(
      request.actorUserId,
      ROOM_ID,
    );

    const nonManager = makeHarness({
      allowedActorServerNames: ['remote.example'],
      manager: false,
    });
    await expect(nonManager.service.setup(request)).resolves.toEqual({
      status: 'not-authorized',
    });
    expect(nonManager.registry.getSnapshot).not.toHaveBeenCalled();
  });

  test('a malformed actor Matrix ID is denied before authorization or setup work', async () => {
    const harness = makeHarness();

    await expect(
      harness.service.setup({ roomId: ROOM_ID, actorUserId: 'moderator' }),
    ).resolves.toEqual({ status: 'not-authorized' });

    expect(harness.authorization.canManageCalendars).not.toHaveBeenCalled();
    expect(harness.matrixClient.getRoomStateEvent).not.toHaveBeenCalled();
    expect(harness.registry.getSnapshot).not.toHaveBeenCalled();
    expect(harness.caldav.reconcile).not.toHaveBeenCalled();
  });

  test.each([
    ['encrypted room', async () => ({ algorithm: 'm.megolm.v1.aes-sha2' })],
    [
      'unknown encryption state',
      async () => {
        throw new MatrixError({ errcode: 'M_FORBIDDEN', error: 'denied' }, 404);
      },
    ],
    [
      'non-404 M_NOT_FOUND response',
      async () => {
        throw new MatrixError(
          { errcode: 'M_NOT_FOUND', error: 'missing' },
          500,
        );
      },
    ],
  ])(
    '%s is unsupported before any persistence or provisioning',
    async (_name, lookup) => {
      const harness = makeHarness({ encryptionLookup: lookup });

      await expect(harness.service.setup(setupRequest)).resolves.toEqual({
        status: 'unsupported-room',
      });

      expect(harness.matrixClient.getJoinedRoomMembers).not.toHaveBeenCalled();
      expect(harness.registry.getSnapshot).not.toHaveBeenCalled();
      expect(harness.bindingStore.reserve).not.toHaveBeenCalled();
      expect(harness.caldav.reconcile).not.toHaveBeenCalled();
      expect(harness.widget.install).not.toHaveBeenCalled();
    },
  );

  test('accepts the exact trusted custom Matrix 404/M_NOT_FOUND tuple', async () => {
    const harness = makeHarness({
      encryptionLookup: async () => {
        throw new Matrix404Error('M_NOT_FOUND', 'missing state', 404);
      },
    });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'created',
    });
    expect(harness.bindingStore.reserve).toHaveBeenCalledTimes(1);
    expect(harness.caldav.reconcile).toHaveBeenCalledTimes(1);
  });

  test('bot membership failure stops before registry and provisioning', async () => {
    const harness = makeHarness({ joinedMembers: [ACTOR_ID] });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'bot-not-ready',
    });

    expect(harness.registry.getSnapshot).not.toHaveBeenCalled();
    expect(harness.bindingStore.reserve).not.toHaveBeenCalled();
    expect(harness.caldav.reconcile).not.toHaveBeenCalled();
  });

  test('missing widget state-event power stops before registry and provisioning', async () => {
    const harness = makeHarness({
      powerLevels: { events_default: 0, state_default: 50, users: {} },
    });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'widget-power-required',
    });

    expect(harness.registry.getSnapshot).not.toHaveBeenCalled();
    expect(harness.bindingStore.reserve).not.toHaveBeenCalled();
    expect(harness.caldav.reconcile).not.toHaveBeenCalled();
    expect(harness.widget.install).not.toHaveBeenCalled();
  });

  test('missing room-message power stops before registry and provisioning', async () => {
    const harness = makeHarness({
      powerLevels: {
        events_default: 1,
        state_default: 50,
        users: { [BOT_ID]: 0 },
      },
    });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'bot-not-ready',
    });

    expect(harness.registry.getSnapshot).not.toHaveBeenCalled();
    expect(harness.bindingStore.reserve).not.toHaveBeenCalled();
    expect(harness.caldav.reconcile).not.toHaveBeenCalled();
  });

  test('accepts legacy string power levels in room version 9', async () => {
    const harness = makeHarness({
      powerLevels: {
        events_default: '0',
        state_default: '50',
        users: { [BOT_ID]: '100' },
      },
      roomState: [
        {
          type: 'm.room.create',
          state_key: '',
          sender: ACTOR_ID,
          content: { room_version: '9' },
        },
      ],
    });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'created',
    });
    expect(harness.registry.getSnapshot).toHaveBeenCalledTimes(1);
  });

  test('truncates fractional power levels in room version 9', async () => {
    const harness = makeHarness({
      powerLevels: {
        events_default: 50.9,
        state_default: 50.1,
        users: { [BOT_ID]: 50.9 },
      },
      roomState: [
        {
          type: 'm.room.create',
          state_key: '',
          sender: ACTOR_ID,
          content: { room_version: '9' },
        },
      ],
    });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'created',
    });
  });

  test('rejects legacy string power levels in room version 10', async () => {
    const harness = makeHarness({
      powerLevels: {
        events_default: 0,
        state_default: 50,
        users: { [BOT_ID]: '100' },
      },
      roomState: [
        {
          type: 'm.room.create',
          state_key: '',
          sender: ACTOR_ID,
          content: { room_version: '10' },
        },
      ],
    });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'bot-not-ready',
    });
    expect(harness.registry.getSnapshot).not.toHaveBeenCalled();
    expect(harness.bindingStore.reserve).not.toHaveBeenCalled();
  });

  test('a verified room-v12 bot creator has the effective power to write setup events', async () => {
    const harness = makeHarness({
      powerLevels: {
        events_default: 99,
        state_default: 101,
        users: { [BOT_ID]: 0 },
      },
      roomState: [
        {
          type: 'm.room.create',
          state_key: '',
          sender: BOT_ID,
          content: { room_version: '12' },
        },
      ],
    });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'created',
    });
    expect(harness.matrixClient.getRoomState).toHaveBeenCalledWith(ROOM_ID);
    expect(harness.registry.getSnapshot).toHaveBeenCalledTimes(1);
  });

  test('a noncreator bot below ordinary message and widget thresholds is denied', async () => {
    const harness = makeHarness({
      powerLevels: {
        events_default: 99,
        state_default: 101,
        users: { [BOT_ID]: 0 },
      },
      roomState: [
        {
          type: 'm.room.create',
          state_key: '',
          sender: ACTOR_ID,
          content: { room_version: '12' },
        },
      ],
    });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'bot-not-ready',
    });
    expect(harness.matrixClient.getRoomState).toHaveBeenCalledWith(ROOM_ID);
    expect(harness.registry.getSnapshot).not.toHaveBeenCalled();
    expect(harness.bindingStore.reserve).not.toHaveBeenCalled();
    expect(harness.caldav.reconcile).not.toHaveBeenCalled();
  });

  test('malformed room-v12 creator state does not grant bot write power', async () => {
    const harness = makeHarness({
      powerLevels: {
        events_default: 99,
        state_default: 101,
        users: { [BOT_ID]: 0 },
      },
      roomState: [
        {
          type: 'm.room.create',
          state_key: '',
          sender: BOT_ID,
          content: {
            room_version: '12',
            additional_creators: ['invalid-user-id'],
          },
        },
      ],
    });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'bot-not-ready',
    });
    expect(harness.registry.getSnapshot).not.toHaveBeenCalled();
    expect(harness.caldav.reconcile).not.toHaveBeenCalled();
  });

  test('static configuration must exactly agree with the validated registry snapshot', async () => {
    const harness = makeHarness({ staticBindings: [STATIC_BINDING] });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'conflict',
    });

    expect(harness.registry.getSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.bindingStore.reserve).not.toHaveBeenCalled();
    expect(harness.caldav.reconcile).not.toHaveBeenCalled();
    expect(harness.widget.install).not.toHaveBeenCalled();
  });

  test('a static binding is verified and installed without a dynamic reservation', async () => {
    const harness = makeHarness({
      staticBindings: [STATIC_BINDING],
      snapshot: [STATIC_BINDING],
      storeEnabled: false,
      caldavOutcome: 'existing',
      widgetOutcome: 'already-present',
    });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'already-ready',
    });

    expect(harness.caldav.reconcile).toHaveBeenCalledWith(
      STATIC_BINDING,
      'verify-only',
    );
    expect(harness.bindingStore.reserve).not.toHaveBeenCalled();
    expect(harness.bindingStore.markReady).not.toHaveBeenCalled();
    expect(harness.widget.install).toHaveBeenCalledWith(STATIC_BINDING);
  });

  test('a new room reserves a server-generated ID, creates its collection, then marks it ready', async () => {
    const harness = makeHarness();

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'created',
    });

    expect(harness.bindingStore.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: DYNAMIC_BINDING,
        staticBindings: [],
        createdBy: ACTOR_ID,
      }),
    );
    expect(harness.caldav.reconcile).toHaveBeenCalledWith(
      DYNAMIC_BINDING,
      'create-if-missing',
    );
    expect(harness.bindingStore.markReady).toHaveBeenCalledWith(
      DYNAMIC_BINDING,
      expect.any(Date),
    );
    expect(harness.widget.install).toHaveBeenCalledWith(DYNAMIC_BINDING);
  });

  test('a capacity failure does not continue into CalDAV or widget setup', async () => {
    const harness = makeHarness({ reserveKind: 'capacity-reached' });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'capacity-reached',
    });

    expect(harness.caldav.reconcile).not.toHaveBeenCalled();
    expect(harness.bindingStore.markReady).not.toHaveBeenCalled();
    expect(harness.widget.install).not.toHaveBeenCalled();
  });

  test('a CalDAV failure leaves the exact reservation pending and installs no widget', async () => {
    const harness = makeHarness({ caldavOutcome: 'missing' });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'pending',
    });

    expect(harness.caldav.reconcile).toHaveBeenCalledWith(
      DYNAMIC_BINDING,
      'create-if-missing',
    );
    expect(harness.bindingStore.markReady).not.toHaveBeenCalled();
    expect(harness.widget.install).not.toHaveBeenCalled();
  });

  test('a CalDAV home mismatch leaves the reservation pending and installs no widget', async () => {
    const harness = makeHarness({ caldavFailure: true });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'pending',
    });

    expect(harness.bindingStore.markReady).not.toHaveBeenCalled();
    expect(harness.widget.install).not.toHaveBeenCalled();
  });

  test('an atomic retry uses the existing pending ID returned by the store', async () => {
    const harness = makeHarness({
      reserveKind: 'existing',
      record: makePendingRecord(RETRY_BINDING),
      caldavOutcome: 'existing',
    });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'already-ready',
    });

    expect(harness.bindingStore.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ binding: DYNAMIC_BINDING }),
    );
    expect(harness.caldav.reconcile).toHaveBeenCalledWith(
      RETRY_BINDING,
      'create-if-missing',
    );
    expect(harness.bindingStore.markReady).toHaveBeenCalledWith(
      RETRY_BINDING,
      expect.any(Date),
    );
    expect(harness.widget.install).toHaveBeenCalledWith(RETRY_BINDING);
  });

  test('a ready dynamic binding is verified without reserving or recreating it', async () => {
    const harness = makeHarness({
      snapshot: [DYNAMIC_BINDING],
      caldavOutcome: 'existing',
      widgetOutcome: 'already-present',
    });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'already-ready',
    });

    expect(harness.bindingStore.reserve).not.toHaveBeenCalled();
    expect(harness.bindingStore.markReady).not.toHaveBeenCalled();
    expect(harness.caldav.reconcile).toHaveBeenCalledWith(
      DYNAMIC_BINDING,
      'verify-only',
    );
  });

  test('a widget write failure after ready returns widget-pending and retry does not reserve another collection', async () => {
    const first = makeHarness({ widgetFailure: true });
    await expect(first.service.setup(setupRequest)).resolves.toEqual({
      status: 'widget-pending',
    });
    expect(first.bindingStore.markReady).toHaveBeenCalledTimes(1);

    const retry = makeHarness({
      snapshot: [DYNAMIC_BINDING],
      caldavOutcome: 'existing',
      widgetOutcome: 'installed',
    });
    await expect(retry.service.setup(setupRequest)).resolves.toEqual({
      status: 'already-ready',
    });
    expect(retry.bindingStore.reserve).not.toHaveBeenCalled();
    expect(retry.bindingStore.markReady).not.toHaveBeenCalled();
    expect(retry.caldav.reconcile).toHaveBeenCalledWith(
      DYNAMIC_BINDING,
      'verify-only',
    );
  });

  test('a post-write widget conflict leaves the ready binding intact', async () => {
    const harness = makeHarness({ widgetOutcome: 'conflict' });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'conflict',
    });

    expect(harness.bindingStore.markReady).toHaveBeenCalledWith(
      DYNAMIC_BINDING,
      expect.any(Date),
    );
    expect(harness.bindingStore.reserve).toHaveBeenCalledTimes(1);
    expect(harness.caldav.reconcile).toHaveBeenCalledTimes(1);
  });

  test('a registry failure fails closed before proof or writes', async () => {
    const harness = makeHarness({ registryFailure: true });

    await expect(harness.service.setup(setupRequest)).resolves.toEqual({
      status: 'unavailable',
    });

    expect(harness.bindingStore.reserve).not.toHaveBeenCalled();
    expect(harness.caldav.reconcile).not.toHaveBeenCalled();
    expect(harness.widget.install).not.toHaveBeenCalled();
  });
});
