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

import { StateEventName } from '../model/StateEventName';
import { WidgetType } from '../model/WidgetType';
import type {
  RoomCalendarSetupWidgetContentPort,
  RoomCalendarSetupWidgetMatrixPort,
} from './RoomCalendarSetupWidgetInstaller';
import { RoomCalendarSetupWidgetInstaller } from './RoomCalendarSetupWidgetInstaller';

const ROOM_ID = '!moderated:matrix.org';
const BOT_ID = '@calendar:matrix.org';
const CALENDAR_ID = 'calendar-00000000-0000-4000-8000-000000000001';
const STATE_KEY = `calendar-widget-${CALENDAR_ID}`;
const API_BASE_URL = 'https://api.example.test/v1';
const CONFIGURED_URL =
  'https://widget.example.test/calendar#/?meetings_bot_base_url=https://api.example.test/v1&theme=dark';
const CANONICAL_URL = `${CONFIGURED_URL}&matrix_room_id=$matrix_room_id`;

function widgetEvent(
  stateKey: string,
  url = CANONICAL_URL,
  type = WidgetType.MEETINGS,
  id: string | null = stateKey,
) {
  return {
    type: StateEventName.IM_VECTOR_MODULAR_WIDGETS_EVENT,
    state_key: stateKey,
    sender: '@moderator:matrix.org',
    content: {
      ...(id === null ? {} : { id }),
      type,
      url,
      name: 'Calendar',
    },
  };
}

function legacyPilotWidget(
  options: {
    roomId?: string;
    type?: string;
    sender?: string;
    creator?: string;
    stateKey?: string;
    contentId?: string;
    roomQuery?: string;
    widgetIdQuery?: string;
    fragmentRoomQuery?: string;
    fragmentWidgetIdQuery?: string;
    duplicateWidgetIdQuery?: string;
    origin?: string;
    path?: string;
  } = {},
) {
  const stateKey = options.stateKey ?? 'calendar-widget-pilot';
  const roomId = options.roomId ?? ROOM_ID;
  const origin = options.origin ?? 'https://widget.example.test';
  const path = options.path ?? '/calendar';
  const roomQuery = options.roomQuery ?? encodeURIComponent(roomId);
  const widgetIdQuery = options.widgetIdQuery
    ? `&matrix_widget_id=${options.widgetIdQuery}`
    : '';
  const fragmentRoomQuery = options.fragmentRoomQuery
    ? `&matrix_room_id=${options.fragmentRoomQuery}`
    : '';
  const fragmentWidgetIdQuery = options.fragmentWidgetIdQuery
    ? `&matrix_widget_id=${options.fragmentWidgetIdQuery}`
    : '';
  const duplicateWidgetIdQuery = options.duplicateWidgetIdQuery
    ? `&matrix_widget_id=${options.duplicateWidgetIdQuery}`
    : '';
  return {
    type: StateEventName.IM_VECTOR_MODULAR_WIDGETS_EVENT,
    state_key: stateKey,
    sender: options.sender ?? BOT_ID,
    content: {
      creator: options.creator ?? BOT_ID,
      type: options.type ?? 'custom',
      url: `${origin}${path}?meetings_bot_base_url=${API_BASE_URL}&matrix_room_id=${roomQuery}${widgetIdQuery}${duplicateWidgetIdQuery}#/?theme=dark&matrix_user_id=$matrix_user_id${fragmentRoomQuery}${fragmentWidgetIdQuery}`,
      name: 'Pilot calendar',
      ...(options.contentId === undefined ? {} : { id: options.contentId }),
      preservedPilotField: { enabled: true },
    },
  };
}

function makeInstaller(
  roomState: unknown[] = [],
  configuredUrl = CONFIGURED_URL,
) {
  const matrixClient: RoomCalendarSetupWidgetMatrixPort = {
    getRoomState: jest.fn().mockResolvedValue(roomState),
    getUserId: jest.fn().mockResolvedValue(BOT_ID),
    sendStateEvent: jest
      .fn()
      .mockImplementation(async (_roomId, type, stateKey, content) => {
        roomState.push({
          type,
          state_key: stateKey,
          sender: BOT_ID,
          content,
        });
        return 'event-id';
      }),
  } as unknown as RoomCalendarSetupWidgetMatrixPort;
  const widgetClient: RoomCalendarSetupWidgetContentPort = {
    getMeetingWidgetEventContentAsync: jest
      .fn()
      .mockResolvedValue({ name: 'Calendar' }),
  } as unknown as RoomCalendarSetupWidgetContentPort;
  const installer = new RoomCalendarSetupWidgetInstaller(
    matrixClient,
    widgetClient,
    configuredUrl,
  );
  return { installer, matrixClient, widgetClient };
}

function roomCalendarParameters(widgetUrl: string): Record<string, string> {
  const parsed = new URL(widgetUrl);
  const hashQuery = parsed.hash.includes('?')
    ? parsed.hash.slice(parsed.hash.indexOf('?') + 1)
    : '';
  return Object.fromEntries([
    ...new URLSearchParams(parsed.search),
    ...new URLSearchParams(hashQuery),
  ]);
}

describe('RoomCalendarSetupWidgetInstaller', () => {
  test('adds the working current widget URL with room and gateway context, without changing layout state', async () => {
    const layoutEvent = {
      type: StateEventName.IO_ELEMENT_WIDGETS_LAYOUT_EVENT,
      state_key: 'im.vector.modular.widgets',
      content: { widgets: ['unrelated-widget'] },
    };
    const { installer, matrixClient, widgetClient } = makeInstaller([
      layoutEvent,
    ]);

    await expect(installer.preflight(ROOM_ID)).resolves.toBe('ready');
    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('installed');

    expect(widgetClient.getMeetingWidgetEventContentAsync).toHaveBeenCalledWith(
      STATE_KEY,
    );
    expect(matrixClient.sendStateEvent).toHaveBeenCalledWith(
      ROOM_ID,
      StateEventName.IM_VECTOR_MODULAR_WIDGETS_EVENT,
      STATE_KEY,
      expect.objectContaining({
        id: STATE_KEY,
        type: WidgetType.MEETINGS,
        url: CANONICAL_URL,
        name: 'Calendar',
      }),
    );
    const sentContent = (matrixClient.sendStateEvent as jest.Mock).mock
      .calls[0][3] as { url: string };
    expect(roomCalendarParameters(sentContent.url)).toMatchObject({
      meetings_bot_base_url: API_BASE_URL,
      matrix_room_id: '$matrix_room_id',
    });
    expect(roomCalendarParameters(sentContent.url)).not.toHaveProperty(
      'widgetId',
    );
    expect(roomCalendarParameters(sentContent.url)).not.toHaveProperty(
      'parentUrl',
    );
    expect(matrixClient.sendStateEvent).not.toHaveBeenCalledWith(
      ROOM_ID,
      StateEventName.IO_ELEMENT_WIDGETS_LAYOUT_EVENT,
      expect.anything(),
      expect.anything(),
    );
  });

  test('adds the room macro to the existing widget fragment when absent', async () => {
    const { installer, matrixClient } = makeInstaller();

    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('installed');

    const sentContent = (matrixClient.sendStateEvent as jest.Mock).mock
      .calls[0][3] as { url: string };
    expect(sentContent.url).toBe(CANONICAL_URL);
  });

  test('requires a safe gateway URL before persistence or widget writes', async () => {
    const missingGateway = makeInstaller(
      [],
      'https://widget.example.test/calendar#/?matrix_room_id=$matrix_room_id',
    );
    const unsafeGateway = makeInstaller(
      [],
      'https://widget.example.test/calendar#/?meetings_bot_base_url=https://user:pass@api.example.test/v1&matrix_room_id=$matrix_room_id',
    );

    await expect(missingGateway.installer.preflight(ROOM_ID)).resolves.toBe(
      'unavailable',
    );
    await expect(unsafeGateway.installer.preflight(ROOM_ID)).resolves.toBe(
      'unavailable',
    );
    expect(missingGateway.matrixClient.sendStateEvent).not.toHaveBeenCalled();
    expect(unsafeGateway.matrixClient.sendStateEvent).not.toHaveBeenCalled();
  });

  test.each([
    [
      'query access token',
      `${CANONICAL_URL}&access_token=private-value`,
    ],
    [
      'case-insensitive fragment password',
      `${CANONICAL_URL}&PaSsWoRd=private-value`,
    ],
    [
      'fragment-only access token',
      'https://widget.example.test/calendar#access_token=private-value',
    ],
    [
      'camel-case fragment Matrix token',
      `${CANONICAL_URL}&matrixAccessToken=private-value`,
    ],
    [
      'widget URL user information',
      'https://widget-user:widget-secret@widget.example.test/calendar#/' +
        '?meetings_bot_base_url=https://api.example.test/v1&matrix_room_id=$matrix_room_id',
    ],
    [
      'nested gateway URL user information',
      'https://widget.example.test/calendar#/' +
        '?meetings_bot_base_url=https://api-user:api-secret@api.example.test/v1&matrix_room_id=$matrix_room_id',
    ],
    [
      'nested gateway API key query',
      `https://widget.example.test/calendar#/?meetings_bot_base_url=${encodeURIComponent('https://api.example.test/v1?api_key=private-value')}&matrix_room_id=$matrix_room_id`,
    ],
  ])('%s is rejected before reading or writing Matrix state', async (_name, url) => {
    const { installer, matrixClient } = makeInstaller([], url);

    await expect(installer.preflight(ROOM_ID)).resolves.toBe('unavailable');
    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('unavailable');
    expect(matrixClient.getRoomState).not.toHaveBeenCalled();
    expect(matrixClient.sendStateEvent).not.toHaveBeenCalled();
  });

  test('does not reuse a current widget with a credential query parameter', async () => {
    const existing = widgetEvent(
      STATE_KEY,
      `${CANONICAL_URL}&access_token=private-value`,
    );
    const { installer, matrixClient, widgetClient } = makeInstaller([existing]);
    await expect(installer.preflight(ROOM_ID)).resolves.toBe('conflict');
    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('conflict');
    expect(matrixClient.sendStateEvent).not.toHaveBeenCalled();
    expect(widgetClient.getMeetingWidgetEventContentAsync).not.toHaveBeenCalled();
  });

  test('does not reuse a pilot widget with a credential fragment parameter', async () => {
    const existing = legacyPilotWidget();
    existing.content.url = `${existing.content.url}&ApiKey=private-value`;
    const { installer, matrixClient, widgetClient } = makeInstaller([existing]);

    await expect(installer.preflight(ROOM_ID)).resolves.toBe('conflict');
    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('conflict');
    expect(matrixClient.sendStateEvent).not.toHaveBeenCalled();
    expect(widgetClient.getMeetingWidgetEventContentAsync).not.toHaveBeenCalled();
  });

  test.each([
    [
      'duplicate room context',
      `${CONFIGURED_URL}&matrix_room_id=$matrix_room_id&matrix_room_id=$matrix_room_id`,
    ],
    [
      'encoded room macro',
      `${CONFIGURED_URL}&matrix_room_id=%24matrix_room_id`,
    ],
    [
      'static widget API identity',
      `${CONFIGURED_URL}&matrix_room_id=$matrix_room_id&widgetId=$matrix_widget_id`,
    ],
    [
      'static widget parent URL',
      `${CONFIGURED_URL}&matrix_room_id=$matrix_room_id&parentUrl=https://element.example.test`,
    ],
    [
      'fragment without a supported route separator',
      'https://widget.example.test/calendar#fragment',
    ],
  ])('%s cannot be used for a new widget', async (_name, url) => {
    const { installer, matrixClient } = makeInstaller([], url);

    await expect(installer.preflight(ROOM_ID)).resolves.toBe('unavailable');
    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('unavailable');
    expect(matrixClient.sendStateEvent).not.toHaveBeenCalled();
  });

  test('a retry reuses an exact current widget entry without writing it again', async () => {
    const { installer, matrixClient, widgetClient } = makeInstaller([
      widgetEvent(STATE_KEY),
    ]);

    await expect(installer.preflight(ROOM_ID)).resolves.toBe('ready');
    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('already-present');

    expect(matrixClient.sendStateEvent).not.toHaveBeenCalled();
    expect(widgetClient.getMeetingWidgetEventContentAsync).not.toHaveBeenCalled();
  });

  test('reuses a matching current widget under its existing widget ID', async () => {
    const existingWidgetId = 'calendar-widget-before-dynamic-binding';
    const { installer, matrixClient, widgetClient } = makeInstaller([
      widgetEvent(existingWidgetId),
    ]);

    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('already-present');

    expect(matrixClient.sendStateEvent).not.toHaveBeenCalled();
    expect(widgetClient.getMeetingWidgetEventContentAsync).not.toHaveBeenCalled();
  });

  test('accepts a current widget whose state_key is its only widget identity', async () => {
    const { installer, matrixClient } = makeInstaller([
      widgetEvent(STATE_KEY, CANONICAL_URL, WidgetType.MEETINGS, null),
    ]);

    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('already-present');
    expect(matrixClient.sendStateEvent).not.toHaveBeenCalled();
  });

  test('reuses the trusted pilot payload under its existing state-key widget ID without rewriting it', async () => {
    const legacy = legacyPilotWidget();
    const { installer, matrixClient, widgetClient } = makeInstaller([legacy]);

    await expect(installer.preflight(ROOM_ID)).resolves.toBe('ready');
    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('already-present');

    expect(matrixClient.sendStateEvent).not.toHaveBeenCalled();
    expect(widgetClient.getMeetingWidgetEventContentAsync).not.toHaveBeenCalled();
    expect(legacy.content).toMatchObject({
      creator: BOT_ID,
      type: 'custom',
      preservedPilotField: { enabled: true },
    });
    expect(legacy.content).not.toHaveProperty('id');
  });

  test('reuses a supported room-template legacy URL and widget-ID URL macro', async () => {
    const legacy = legacyPilotWidget({
      roomQuery: '$matrix_room_id',
      widgetIdQuery: '$matrix_widget_id',
    });
    const { installer, matrixClient } = makeInstaller([legacy]);

    await expect(installer.preflight(ROOM_ID)).resolves.toBe('ready');
    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('already-present');
    expect(matrixClient.sendStateEvent).not.toHaveBeenCalled();
  });

  test('reuses a supported m.custom widget when the literal content ID matches its state key', async () => {
    const legacy = legacyPilotWidget({
      type: 'm.custom',
      contentId: 'calendar-widget-pilot',
    });
    const { installer, matrixClient } = makeInstaller([legacy]);

    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('already-present');
    expect(matrixClient.sendStateEvent).not.toHaveBeenCalled();
  });

  test.each([
    ['wrong state-event sender', { sender: '@other-bot:matrix.org' }],
    ['wrong creator', { creator: '@other-bot:matrix.org' }],
    ['wrong room', { roomId: '!different:matrix.org' }],
    [
      'same-endpoint URL with embedded credentials',
      { origin: 'https://user:pass@widget.example.test' },
    ],
    ['unsupported widget kind', { type: 'unrelated-custom-type' }],
    ['mismatched content ID', { contentId: 'different-widget-id' }],
    ['templated content ID', { contentId: '$matrix_widget_id' }],
    ['mismatched widget-ID query', { widgetIdQuery: 'different-widget-id' }],
    [
      'conflicting room query and fragment',
      { fragmentRoomQuery: encodeURIComponent('!different:matrix.org') },
    ],
    [
      'conflicting widget-ID query and fragment',
      {
        widgetIdQuery: 'calendar-widget-pilot',
        fragmentWidgetIdQuery: 'different-widget-id',
      },
    ],
    [
      'duplicate widget-ID query',
      {
        widgetIdQuery: 'calendar-widget-pilot',
        duplicateWidgetIdQuery: 'calendar-widget-pilot',
      },
    ],
  ] as const)(
    '%s is an uncertain same-endpoint lookalike and is preserved as a conflict',
    async (_name, options) => {
      const { installer, matrixClient, widgetClient } = makeInstaller([
        legacyPilotWidget(options),
      ]);

      await expect(installer.preflight(ROOM_ID)).resolves.toBe('conflict');
      await expect(
        installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
      ).resolves.toBe('conflict');
      expect(matrixClient.sendStateEvent).not.toHaveBeenCalled();
      expect(widgetClient.getMeetingWidgetEventContentAsync).not.toHaveBeenCalled();
    },
  );

  test('a same-endpoint event with a different occupied stable key is not overwritten', async () => {
    const occupied = widgetEvent(STATE_KEY, CANONICAL_URL, WidgetType.COCKPIT);
    const { installer, matrixClient, widgetClient } = makeInstaller([occupied]);

    await expect(installer.preflight(ROOM_ID)).resolves.toBe('conflict');
    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('conflict');
    expect(matrixClient.sendStateEvent).not.toHaveBeenCalled();
    expect(widgetClient.getMeetingWidgetEventContentAsync).not.toHaveBeenCalled();
  });

  test('preserves a state key that becomes occupied while the widget payload is built', async () => {
    const { installer, matrixClient } = makeInstaller();
    const getRoomState = matrixClient.getRoomState as jest.Mock;
    getRoomState
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        widgetEvent(STATE_KEY, CANONICAL_URL, WidgetType.COCKPIT),
      ]);

    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('conflict');
    expect(matrixClient.sendStateEvent).not.toHaveBeenCalled();
  });

  test('reports a post-write state change without trying to restore the prior payload', async () => {
    const { installer, matrixClient } = makeInstaller();
    const changedEvent = widgetEvent(STATE_KEY);
    changedEvent.sender = BOT_ID;
    changedEvent.content.name = 'Changed by another writer';
    const getRoomState = matrixClient.getRoomState as jest.Mock;
    getRoomState
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([changedEvent]);

    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('conflict');
    expect(matrixClient.sendStateEvent).toHaveBeenCalledTimes(1);
  });

  test('a different-path widget remains unrelated and is not overwritten', async () => {
    const unrelated = widgetEvent(
      'unrelated-calendar-widget',
      `https://widget.example.test/other#/?meetings_bot_base_url=${API_BASE_URL}&matrix_room_id=$matrix_room_id`,
    );
    const { installer, matrixClient } = makeInstaller([unrelated]);

    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('installed');
    expect(matrixClient.sendStateEvent).toHaveBeenCalledWith(
      ROOM_ID,
      StateEventName.IM_VECTOR_MODULAR_WIDGETS_EVENT,
      STATE_KEY,
      expect.objectContaining({ type: WidgetType.MEETINGS }),
    );
  });

  test('multiple matching trusted legacy widgets return conflict rather than adding another', async () => {
    const { installer, matrixClient } = makeInstaller([
      legacyPilotWidget({ stateKey: 'calendar-widget-pilot-1' }),
      legacyPilotWidget({ stateKey: 'calendar-widget-pilot-2' }),
    ]);

    await expect(installer.preflight(ROOM_ID)).resolves.toBe('conflict');
    await expect(
      installer.install({ roomId: ROOM_ID, calendarId: CALENDAR_ID }),
    ).resolves.toBe('conflict');
    expect(matrixClient.sendStateEvent).not.toHaveBeenCalled();
  });
});
