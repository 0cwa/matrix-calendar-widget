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

import { MatrixClient, MatrixError, MessageEventContent } from 'matrix-bot-sdk';
import {
  anyString,
  anything,
  capture,
  instance,
  mock,
  reset,
  verify,
  when,
} from 'ts-mockito';
import { AppRuntimeContext } from '../src/AppRuntimeContext';
import { IAppConfiguration } from '../src/IAppConfiguration';
import { TranslatableError } from '../src/error/TranslatableError';
import { IRoomEvent } from '../src/matrix/event/IRoomEvent';
import { StateEventName } from '../src/model/StateEventName';
import { CalendarCommandService } from '../src/service/CalendarCommandService';
import { CommandService, SETUP_COMMANDS } from '../src/service/CommandService';
import { WelcomeWorkflowService } from '../src/service/WelcomeWorkflowService';
import { createAppConfig } from './util/MockUtils';

describe('test CommandService', () => {
  const ROOM_ID = '!room:matrix.org';
  const USER_ID = 'userId';
  const BOT_ID = '@bot:matrix.com';

  const appConfig: IAppConfiguration = {
    ...createAppConfig(),
    welcome_workflow_default_locale: 'de', // <= default locale
  };

  const privateRoomMarkerEvent = {
    roomId: ROOM_ID,
    originalRoomName: 'originalRoomName',
    originalRoomId: 'originalRoomId',
    locale: 'en', // <= locale in the private room
    userId: USER_ID,
    userDisplayName: 'displayname',
  };

  const matrixClientMock = mock(MatrixClient);
  const calendarCommandServiceMock = mock(CalendarCommandService);
  let welcomeWorkflowService: WelcomeWorkflowService;
  let calendarCommandService: CalendarCommandService;
  let commandService: CommandService;

  const createEvent = () =>
    ({
      event_id: 'some_event_id',
      sender: '@sender:matrix.org',
      content: {
        body: '!meeting help',
        msgtype: 'm.text',
      },
      origin_server_ts: Date.now(),
    }) as IRoomEvent<MessageEventContent>;

  const appRuntimeContext: AppRuntimeContext = new AppRuntimeContext(
    BOT_ID,
    '',
    '',
    ['en'],
  );

  const captureSendHtmlText = () => {
    return capture(matrixClientMock.sendHtmlText).first()[1] as string;
  };

  const captureCalendarMessage = () =>
    capture(matrixClientMock.sendMessage).last()[1] as {
      body: string;
      format?: string;
      formatted_body?: string;
      'm.mentions'?: Record<string, unknown>;
    };

  const captureCalendarText = () => captureCalendarMessage().body;

  const makeCalendarMatrixClient = (
    lookupEncryptionState: () => Promise<unknown>,
    crypto?: { isRoomEncrypted: jest.Mock },
  ) => {
    const getRoomStateEvent = jest.fn(
      async (_roomId: string, eventType: string) => {
        if (eventType === 'm.room.encryption') {
          return lookupEncryptionState();
        }
        return undefined;
      },
    );
    const sendMessage = jest.fn().mockResolvedValue('$calendar-reply');
    return {
      client: {
        getRoomStateEvent,
        sendMessage,
        crypto,
      } as unknown as MatrixClient,
      getRoomStateEvent,
      sendMessage,
    };
  };

  const makeRoomPublic = (roomId = ROOM_ID) => {
    when(
      matrixClientMock.getRoomStateEvent(
        roomId,
        StateEventName.NIC_MEETINGS_WELCOME_ROOM,
        appRuntimeContext.botUserId,
      ),
    ).thenThrow(new Error('no NIC_MEETINGS_WELCOME_ROOM event'));
  };

  const makeRoomPrivate = (roomId = ROOM_ID) => {
    when(
      matrixClientMock.getRoomStateEvent(
        roomId,
        StateEventName.NIC_MEETINGS_WELCOME_ROOM,
        appRuntimeContext.botUserId,
      ),
    ).thenResolve(privateRoomMarkerEvent);
  };

  beforeEach(() => {
    welcomeWorkflowService = mock(WelcomeWorkflowService);
    calendarCommandService = instance(calendarCommandServiceMock);
    when(
      calendarCommandServiceMock.execute(
        anyString(),
        anyString(),
        anyString(),
        anything(),
      ),
    ).thenResolve('Calendar command response');
    commandService = new CommandService(
      instance(matrixClientMock),
      instance(welcomeWorkflowService),
      appConfig,
      appRuntimeContext,
      calendarCommandService,
    );

    when(
      matrixClientMock.getRoomStateEvent(anyString(), 'm.room.encryption', ''),
    ).thenThrow(
      new MatrixError({ errcode: 'M_NOT_FOUND', error: 'not encrypted' }, 404),
    );

    when(matrixClientMock.getUserProfile(BOT_ID)).thenResolve({
      displayname: BOT_ID,
    });
  });

  afterEach(() => {
    reset(matrixClientMock);
    reset(calendarCommandServiceMock);
  });

  test('handleRoomMessage help command', async () => {
    const event = createEvent();
    event.content.body = '!meeting help';
    await commandService.handleRoomMessage(ROOM_ID, event);
    verify(matrixClientMock.sendHtmlText(ROOM_ID, anyString())).once();
    const txt = captureSendHtmlText();
    expect(txt).toMatch(/Verfügbare Befehle:/);
    expect(txt).toContain('!meeting setup');
    expect(txt).not.toContain('!calendar help');
  });

  test('calendar help directs widget-capable clients to the widget', async () => {
    makeRoomPrivate();
    const event = createEvent();
    event.content.body = '!calendar help';

    await commandService.handleRoomMessage(ROOM_ID, event);

    verify(matrixClientMock.sendHtmlText(ROOM_ID, anyString())).never();
    const txt = captureCalendarText();
    expect(txt).toContain('!calendar help');
    expect(txt).toContain('!calendar upcoming [count] [--tz IANA]');
    expect(txt).toContain('server write gate');
    expect(txt).not.toContain('<li>');
    expect(txt).toContain('!calendar event <resource-id>');
    expect(captureCalendarMessage().formatted_body).toBeUndefined();
    expect(captureCalendarMessage()['m.mentions']).toEqual({});
  });

  test('silently drops burst-limited help and malformed commands for v12 and legacy IDs before Matrix or calendar work', async () => {
    const matrix = makeCalendarMatrixClient(async () => {
      throw new MatrixError(
        { errcode: 'M_NOT_FOUND', error: 'not encrypted' },
        404,
      );
    });
    const calendarRunner = {
      execute: jest.fn().mockResolvedValue('Upcoming events'),
    } as unknown as CalendarCommandService;
    const service = new CommandService(
      matrix.client,
      instance(welcomeWorkflowService),
      appConfig,
      appRuntimeContext,
      calendarRunner,
    );

    const roomActors = [
      {
        roomId: '!Nhcu5BS-UMnFX7hBVfVSoXiD7OgH6iRT-xyIuqDnpYQ',
        sender: '@alice:matrix.org',
      },
      {
        roomId: '!🗓~archive:example.org',
        sender: '@legacy~ actor:example.org',
      },
    ];
    for (const { roomId, sender } of roomActors) {
      for (let index = 0; index < 5; index += 1) {
        const event = createEvent();
        event.sender = sender;
        event.content.body = '!calendar help';
        await service.handleRoomMessage(roomId, event);
      }
      const acceptedCommand = createEvent();
      acceptedCommand.sender = sender;
      acceptedCommand.content.body = '!calendar upcoming';
      await service.handleRoomMessage(roomId, acceptedCommand);
    }
    expect(calendarRunner.execute).toHaveBeenCalledTimes(2);

    const stateLookupCount = matrix.getRoomStateEvent.mock.calls.length;
    const replyCount = matrix.sendMessage.mock.calls.length;
    const rejectedBodies = ['!calendarhelp', '!calendar help'];
    for (const { roomId, sender } of roomActors) {
      for (const body of rejectedBodies) {
        const event = createEvent();
        event.sender = sender;
        event.content.body = body;
        await service.handleRoomMessage(roomId, event);
      }
    }

    expect(matrix.getRoomStateEvent).toHaveBeenCalledTimes(stateLookupCount);
    expect(matrix.sendMessage).toHaveBeenCalledTimes(replyCount);
    expect(calendarRunner.execute).toHaveBeenCalledTimes(2);
  });

  test('holds the actor slot through reply I/O and releases it afterward', async () => {
    const matrix = makeCalendarMatrixClient(async () => {
      throw new MatrixError(
        { errcode: 'M_NOT_FOUND', error: 'not encrypted' },
        404,
      );
    });
    let finishSend!: () => void;
    let notifySendStarted!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      finishSend = resolve;
    });
    const sendStarted = new Promise<void>((resolve) => {
      notifySendStarted = resolve;
    });
    matrix.sendMessage.mockImplementation(async () => {
      notifySendStarted();
      await sendGate;
      return '$calendar-reply';
    });
    const calendarRunner = {
      execute: jest.fn().mockResolvedValue('Upcoming events'),
    } as unknown as CalendarCommandService;
    const service = new CommandService(
      matrix.client,
      instance(welcomeWorkflowService),
      appConfig,
      appRuntimeContext,
      calendarRunner,
    );
    const firstEvent = createEvent();
    firstEvent.content.body = '!calendar upcoming';
    const firstCommand = service.handleRoomMessage(ROOM_ID, firstEvent);
    await sendStarted;

    const stateLookupCount = matrix.getRoomStateEvent.mock.calls.length;
    const secondEvent = createEvent();
    secondEvent.content.body = '!calendar help';
    await service.handleRoomMessage(ROOM_ID, secondEvent);
    expect(matrix.getRoomStateEvent).toHaveBeenCalledTimes(stateLookupCount);
    expect(calendarRunner.execute).toHaveBeenCalledTimes(1);

    finishSend();
    await firstCommand;

    const thirdEvent = createEvent();
    thirdEvent.content.body = '!calendar upcoming';
    await service.handleRoomMessage(ROOM_ID, thirdEvent);
    expect(calendarRunner.execute).toHaveBeenCalledTimes(2);
  });

  test('releases the actor slot after an exceptional calendar operation', async () => {
    const matrix = makeCalendarMatrixClient(async () => {
      throw new MatrixError(
        { errcode: 'M_NOT_FOUND', error: 'not encrypted' },
        404,
      );
    });
    const calendarRunner = {
      execute: jest
        .fn()
        .mockRejectedValueOnce(new Error('private operation details'))
        .mockResolvedValue('Upcoming events'),
    } as unknown as CalendarCommandService;
    const service = new CommandService(
      matrix.client,
      instance(welcomeWorkflowService),
      appConfig,
      appRuntimeContext,
      calendarRunner,
    );

    for (let index = 0; index < 2; index += 1) {
      const event = createEvent();
      event.content.body = '!calendar upcoming';
      await service.handleRoomMessage(ROOM_ID, event);
    }

    expect(calendarRunner.execute).toHaveBeenCalledTimes(2);
    expect(matrix.sendMessage).toHaveBeenCalledTimes(2);
    const replies = matrix.sendMessage.mock.calls.map(
      ([, message]) => (message as { body: string }).body,
    );
    expect(replies).toContain('Upcoming events');
    expect(
      replies.some((reply) => reply.includes('private operation details')),
    ).toBe(false);
  });

  test('silently rejects untrusted or unbounded room and sender identifiers', async () => {
    const matrix = makeCalendarMatrixClient(async () => {
      throw new MatrixError(
        { errcode: 'M_NOT_FOUND', error: 'not encrypted' },
        404,
      );
    });
    const calendarRunner = {
      execute: jest.fn().mockResolvedValue('Upcoming events'),
    } as unknown as CalendarCommandService;
    const service = new CommandService(
      matrix.client,
      instance(welcomeWorkflowService),
      appConfig,
      appRuntimeContext,
      calendarRunner,
    );
    const event = createEvent();
    event.content.body = '!calendar help';
    event.sender = 'not-a-matrix-user';

    await service.handleRoomMessage(ROOM_ID, event);

    expect(matrix.getRoomStateEvent).not.toHaveBeenCalled();
    expect(matrix.sendMessage).not.toHaveBeenCalled();
    expect(calendarRunner.execute).not.toHaveBeenCalled();
  });

  test('calendar help remains available when the welcome workflow is disabled', async () => {
    makeRoomPrivate();
    const event = createEvent();
    event.content.body = '!calendar help';
    const disabledService = new CommandService(
      instance(matrixClientMock),
      instance(welcomeWorkflowService),
      { ...appConfig, enable_welcome_workflow: false },
      appRuntimeContext,
      calendarCommandService,
    );

    await disabledService.handleRoomMessage(ROOM_ID, event);

    verify(matrixClientMock.sendHtmlText(ROOM_ID, anyString())).never();
    expect(captureCalendarText()).toContain(
      '!calendar create <YYYY-MM-DDTHH:mm>',
    );
    verify(welcomeWorkflowService.handleAddWidgetCommand(ROOM_ID)).never();
  });

  test('legacy meeting commands remain disabled with the welcome workflow', async () => {
    const event = createEvent();
    event.content.body = '!meeting setup';
    const disabledService = new CommandService(
      instance(matrixClientMock),
      instance(welcomeWorkflowService),
      { ...appConfig, enable_welcome_workflow: false },
      appRuntimeContext,
      calendarCommandService,
    );

    await disabledService.handleRoomMessage(ROOM_ID, event);

    verify(matrixClientMock.sendHtmlText(ROOM_ID, anyString())).never();
    verify(welcomeWorkflowService.handleAddWidgetCommand(ROOM_ID)).never();
  });

  test('legacy meeting help remains disabled with the welcome workflow', async () => {
    const event = createEvent();
    event.content.body = '!meeting help';
    const disabledService = new CommandService(
      instance(matrixClientMock),
      instance(welcomeWorkflowService),
      { ...appConfig, enable_welcome_workflow: false },
      appRuntimeContext,
      calendarCommandService,
    );

    await disabledService.handleRoomMessage(ROOM_ID, event);

    verify(matrixClientMock.sendHtmlText(ROOM_ID, anyString())).never();
    verify(welcomeWorkflowService.handleAddWidgetCommand(ROOM_ID)).never();
    verify(welcomeWorkflowService.handleStatusCommand(ROOM_ID)).never();
    verify(welcomeWorkflowService.handleLanguageChange(ROOM_ID, [])).never();
  });

  test('calendar help uses the default locale when no room locale exists', async () => {
    makeRoomPublic();
    const event = createEvent();
    event.content.body = '!calendar help';

    await commandService.handleRoomMessage(ROOM_ID, event);

    const txt = captureCalendarText();
    expect(txt).toContain('Raumkalender-Befehle');
    expect(txt).toContain('!calendar help');
    expect(txt).toContain('Clients, die Widgets unterstützen');
  });

  test('calendar command without a subcommand asks for help', async () => {
    const event = createEvent();
    event.content.body = '!calendar';

    await commandService.handleRoomMessage(ROOM_ID, event);

    const [roomId, message] = capture(matrixClientMock.sendMessage).last();
    expect(roomId).toBe(ROOM_ID);
    expect((message as { 'm.relates_to'?: unknown })['m.relates_to']).toEqual({
      'm.in_reply_to': { event_id: event.event_id },
    });
    const text = (message as { body: string }).body;
    expect(text).toContain('!calendar help');
  });

  test('unknown calendar subcommands return localized plain-text guidance', async () => {
    const event = createEvent();
    event.content.body = '!calendar unknown';

    await commandService.handleRoomMessage(ROOM_ID, event);

    const text = captureCalendarText();
    expect(text).toEqual('Calendar command response');
    expect(captureCalendarMessage().formatted_body).toBeUndefined();
    expect(captureCalendarMessage()['m.mentions']).toEqual({});
    verify(
      calendarCommandServiceMock.execute(
        ROOM_ID,
        '@sender:matrix.org',
        'unknown',
        anything(),
      ),
    ).once();
  });

  test('does not execute a calendar command in an encrypted room without crypto', async () => {
    const matrix = makeCalendarMatrixClient(async () => ({
      algorithm: 'm.megolm.v1.aes-sha2',
    }));
    const service = new CommandService(
      matrix.client,
      instance(welcomeWorkflowService),
      { ...appConfig, enable_crypto: false },
      appRuntimeContext,
      calendarCommandService,
    );
    const event = createEvent();
    event.content.body = '!calendar upcoming';

    await service.handleRoomMessage(ROOM_ID, event);

    verify(
      calendarCommandServiceMock.execute(
        anyString(),
        anyString(),
        anyString(),
        anything(),
      ),
    ).never();
    expect(matrix.sendMessage).not.toHaveBeenCalled();
    expect(matrix.getRoomStateEvent).toHaveBeenCalledTimes(1);
  });

  test('fails closed when current encryption state is unavailable', async () => {
    const matrix = makeCalendarMatrixClient(async () => {
      throw new MatrixError(
        { errcode: 'M_FORBIDDEN', error: 'unavailable' },
        404,
      );
    });
    const service = new CommandService(
      matrix.client,
      instance(welcomeWorkflowService),
      { ...appConfig, enable_crypto: true },
      appRuntimeContext,
      calendarCommandService,
    );
    const event = createEvent();
    event.content.body = '!calendar event event.ics';

    await service.handleRoomMessage(ROOM_ID, event);

    verify(
      calendarCommandServiceMock.execute(
        anyString(),
        anyString(),
        anyString(),
        anything(),
      ),
    ).never();
    expect(matrix.sendMessage).not.toHaveBeenCalled();
  });

  test('fails closed when SDK crypto does not confirm an encrypted room', async () => {
    const crypto = { isRoomEncrypted: jest.fn().mockResolvedValue(false) };
    const matrix = makeCalendarMatrixClient(
      async () => ({ algorithm: 'm.megolm.v1.aes-sha2' }),
      crypto,
    );
    const service = new CommandService(
      matrix.client,
      instance(welcomeWorkflowService),
      { ...appConfig, enable_crypto: true },
      appRuntimeContext,
      calendarCommandService,
    );
    const event = createEvent();
    event.content.body = '!calendar upcoming';

    await service.handleRoomMessage(ROOM_ID, event);

    expect(crypto.isRoomEncrypted).toHaveBeenCalledTimes(1);
    expect(matrix.sendMessage).not.toHaveBeenCalled();
    verify(
      calendarCommandServiceMock.execute(
        anyString(),
        anyString(),
        anyString(),
        anything(),
      ),
    ).never();
  });

  test('rechecks the room before replying if it becomes encrypted during execution', async () => {
    let encryptionReads = 0;
    const matrix = makeCalendarMatrixClient(async () => {
      encryptionReads += 1;
      if (encryptionReads === 1) {
        throw new MatrixError(
          { errcode: 'M_NOT_FOUND', error: 'not encrypted' },
          404,
        );
      }
      return { algorithm: 'm.megolm.v1.aes-sha2' };
    });
    const commandRunner = {
      execute: jest.fn().mockResolvedValue('Private calendar result'),
    } as unknown as CalendarCommandService;
    const service = new CommandService(
      matrix.client,
      instance(welcomeWorkflowService),
      { ...appConfig, enable_crypto: false },
      appRuntimeContext,
      commandRunner,
    );
    const event = createEvent();
    event.content.body = '!calendar upcoming';

    await service.handleRoomMessage(ROOM_ID, event);

    expect(commandRunner.execute).toHaveBeenCalledTimes(1);
    expect(encryptionReads).toBe(2);
    expect(matrix.sendMessage).not.toHaveBeenCalled();
  });

  test('rechecks encryption and sends only plain text with empty mention metadata', async () => {
    const crypto = { isRoomEncrypted: jest.fn().mockResolvedValue(true) };
    const matrix = makeCalendarMatrixClient(
      async () => ({ algorithm: 'm.megolm.v1.aes-sha2' }),
      crypto,
    );
    const adversarialResult = 'Event: <img src=x onerror=alert(1)> @room';
    const commandRunner = {
      execute: jest.fn().mockResolvedValue(adversarialResult),
    } as unknown as CalendarCommandService;
    const service = new CommandService(
      matrix.client,
      instance(welcomeWorkflowService),
      { ...appConfig, enable_crypto: true },
      appRuntimeContext,
      commandRunner,
    );
    const event = createEvent();
    event.content.body = '!calendar upcoming';

    await service.handleRoomMessage(ROOM_ID, event);

    expect(commandRunner.execute).toHaveBeenCalledTimes(1);
    expect(crypto.isRoomEncrypted).toHaveBeenCalledTimes(2);
    expect(
      matrix.getRoomStateEvent.mock.calls.filter(
        ([, eventType]) => eventType === 'm.room.encryption',
      ),
    ).toHaveLength(2);
    expect(matrix.sendMessage).toHaveBeenCalledWith(ROOM_ID, {
      msgtype: 'm.text',
      body: adversarialResult,
      'm.mentions': {},
      'm.relates_to': {
        'm.in_reply_to': { event_id: event.event_id },
      },
    });
    const [, content] = matrix.sendMessage.mock.calls[0];
    expect(content.format).toBeUndefined();
    expect(content.formatted_body).toBeUndefined();
  });

  test('calendar help rejects extra arguments as malformed input', async () => {
    const event = createEvent();
    event.content.body = '!calendar help extra';

    await commandService.handleRoomMessage(ROOM_ID, event);

    const text = captureCalendarText();
    expect(text).toContain('!calendar help');
    expect(text).not.toContain('<code>');
  });

  test('passes the complete quoted calendar command tail to the runtime', async () => {
    const event = createEvent();
    event.content.body =
      '!calendar create 2026-10-04T13:00 2026-10-04T14:00 "Planning meeting" --description "Bring the draft"';

    await commandService.handleRoomMessage(ROOM_ID, event);

    verify(
      calendarCommandServiceMock.execute(
        ROOM_ID,
        '@sender:matrix.org',
        'create 2026-10-04T13:00 2026-10-04T14:00 "Planning meeting" --description "Bring the draft"',
        anything(),
      ),
    ).once();
    const [replyRoom, message] = capture(matrixClientMock.sendMessage).last();
    expect(replyRoom).toBe(ROOM_ID);
    expect((message as { body: string }).body).toBe(
      'Calendar command response',
    );
    expect((message as { formatted_body?: string }).formatted_body).toBe(
      undefined,
    );
    expect((message as { format?: string }).format).toBeUndefined();
  });

  test('calendar trigger requires a token boundary before the command', async () => {
    const event = createEvent();
    event.content.body = '!calendarhelp';

    await commandService.handleRoomMessage(ROOM_ID, event);

    verify(matrixClientMock.sendHtmlText(ROOM_ID, anyString())).never();
    const text = captureCalendarText();
    expect(text).toContain('!calendar help');
  });

  test('handleRoomMessage a custom command', async () => {
    const event = createEvent();
    event.content.body = `!meeting ${SETUP_COMMANDS[0]}`;
    await commandService.handleRoomMessage(ROOM_ID, event);
    verify(welcomeWorkflowService.handleAddWidgetCommand(ROOM_ID)).once();
  });

  test('ignores msgtype other than m.text', async () => {
    const event = createEvent();
    event.content.msgtype = 'm.emote';
    event.content.body = `!meeting ${SETUP_COMMANDS[0]}`;
    await commandService.handleRoomMessage(ROOM_ID, event);
    verify(matrixClientMock.sendHtmlText(ROOM_ID, anyString())).never();
    verify(welcomeWorkflowService.handleAddWidgetCommand(ROOM_ID)).never();
  });

  test('ignore when no trigger', async () => {
    const event = createEvent();
    event.content.body = `doesn't start with a trigger !meeting ${SETUP_COMMANDS[0]}`;
    await commandService.handleRoomMessage(ROOM_ID, event);
    verify(matrixClientMock.sendHtmlText(ROOM_ID, anyString())).never();
    verify(welcomeWorkflowService.handleAddWidgetCommand(ROOM_ID)).never();
  });

  test('error when no command', async () => {
    const event = createEvent();
    event.content.body = '!meeting';
    await commandService.handleRoomMessage(ROOM_ID, event);
    verify(matrixClientMock.sendHtmlText(ROOM_ID, anyString())).never();
    // expect(callCount).toBe(0); // TODO: MA

    const txt = capture(matrixClientMock.replyText).last()[2];
    expect(txt).toEqual(
      'Der Befehl steht nicht zur Verfügung. Schreibe <code>!meeting help</code>',
    );
  });

  test('error when invalid command', async () => {
    const event = createEvent();
    event.content.body = '!meeting bad';
    await commandService.handleRoomMessage(ROOM_ID, event);
    verify(matrixClientMock.sendHtmlText(ROOM_ID, anyString())).never();
    // expect(callCount).toBe(0); // TODO: MA

    const txt = capture(matrixClientMock.replyText).last()[2];
    expect(txt).toEqual(
      'Der Hilfe-Befehl ist leider nicht richtig. Schreibe <code>!meeting help</code>',
    );
  });

  test('error NicError during command handle', async () => {
    const event = createEvent();
    event.content.body = `!meeting ${SETUP_COMMANDS[0]}`;
    when(welcomeWorkflowService.handleAddWidgetCommand(ROOM_ID)).thenThrow(
      new TranslatableError('commandErrors.generic', {
        message: 'example',
      }),
    );
    await commandService.handleRoomMessage(ROOM_ID, event);

    const txt = capture(matrixClientMock.replyText).last()[2];
    expect(txt).toEqual(
      'Leider konnte Dein Befehl nicht korrekt ausgeführt werden: example',
    );
  });

  test('error Error during command handle', async () => {
    const event = createEvent();
    event.content.body = `!meeting ${SETUP_COMMANDS[0]}`;

    const errMsg = 'Error';
    when(welcomeWorkflowService.handleAddWidgetCommand(ROOM_ID)).thenThrow(
      new Error(errMsg),
    );
    await commandService.handleRoomMessage(ROOM_ID, event);

    const txt = capture(matrixClientMock.replyText).last()[2];
    expect(txt).toEqual(
      'Leider konnte Dein Befehl nicht korrekt ausgeführt werden: Error',
    );
  });

  test('locale detection in private room', async () => {
    makeRoomPrivate(ROOM_ID);
    const event = createEvent();
    event.content.body = '!meeting help';
    await commandService.handleRoomMessage(ROOM_ID, event);
    const txt = captureSendHtmlText();
    // expect a custom locale from the private room
    expect(txt).toMatch(/Available commands:/);
  });

  test('locale detection in public room', async () => {
    makeRoomPublic(ROOM_ID);
    const event = createEvent();
    event.content.body = '!meeting help';
    await commandService.handleRoomMessage(ROOM_ID, event);
    const txt = captureSendHtmlText();
    // expect the default locale from the appConfig
    expect(txt).toMatch(/Verfügbare Befehle:/);
  });
});
