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

import { Inject, Injectable, Logger } from '@nestjs/common';
import i18next from 'i18next';
import { MatrixClient, MatrixError, MessageEventContent } from 'matrix-bot-sdk';
import { AppRuntimeContext } from '../AppRuntimeContext';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import { TranslatableError } from '../error/TranslatableError';
import { IRoomEvent } from '../matrix/event/IRoomEvent';
import { StateEventName } from '../model/StateEventName';
import { CalendarCommandService } from './CalendarCommandService';
import { WelcomeWorkflowService } from './WelcomeWorkflowService';

const TRIGGER = '!meeting';
const CALENDAR_TRIGGER = '!calendar';

export const HELP_COMMANDS: string[] = ['help', 'h'];
export const STATUS_COMMANDS: string[] = ['status', 'stat'];
export const SETUP_COMMANDS: string[] = ['setup', 'addwidget'];
export const LANG_COMMANDS: string[] = ['lang', 'language'];

@Injectable()
export class CommandService {
  private logger = new Logger(CommandService.name);

  private readonly botUserId: string;

  constructor(
    private readonly matrixClient: MatrixClient,
    private readonly welcomeWorkflowService: WelcomeWorkflowService,
    @Inject(ModuleProviderToken.APP_CONFIGURATION)
    private readonly appConfig: IAppConfiguration,
    appRuntimeContext: AppRuntimeContext,
    @Inject(CalendarCommandService)
    private readonly calendarCommandService: CalendarCommandService,
  ) {
    this.botUserId = appRuntimeContext.botUserId;
  }

  public async handleRoomMessage(
    roomId: string,
    event: IRoomEvent<MessageEventContent>,
  ) {
    const { content: { msgtype = '' } = {} } = event;
    if (msgtype !== 'm.text') return;

    const triggers: string[] = [TRIGGER, CALENDAR_TRIGGER, this.botUserId];
    const body: string = event.content.body;

    const malformedCalendarTrigger =
      body.startsWith(CALENDAR_TRIGGER) &&
      body.length > CALENDAR_TRIGGER.length &&
      !/\s/.test(body.charAt(CALENDAR_TRIGGER.length));
    if (malformedCalendarTrigger) {
      return this.replyCalendarError(roomId, event, 'badSyntax');
    }

    const triggered = triggers.find((trigger) => body.startsWith(trigger));
    if (!triggered) return;
    if (
      !this.appConfig.enable_welcome_workflow &&
      triggered !== CALENDAR_TRIGGER
    ) {
      return;
    }

    const withoutTrigger = body.substring(triggered.length).trim();

    if (withoutTrigger.length === 0) {
      if (triggered === CALENDAR_TRIGGER) {
        return this.replyCalendarError(roomId, event, 'badSyntax');
      }
      this.logger.verbose(
        `commandErrors.noCommandProvided triggered: ${triggered}`,
      );
      return this.replyWithError(
        roomId,
        event,
        'commandErrors.noCommandProvided',
        {
          trigger: triggered === CALENDAR_TRIGGER ? CALENDAR_TRIGGER : TRIGGER,
        },
      );
    }

    const commandName = (withoutTrigger.match(/^\S+/)?.[0] ?? '').slice(0, 32);
    const cmdArgs =
      triggered === CALENDAR_TRIGGER ? [] : withoutTrigger.split(' ').slice(1);

    try {
      if (triggered === CALENDAR_TRIGGER) {
        await this.processCalendarCommand(withoutTrigger, roomId, event);
      } else {
        await this.processCommand(commandName, roomId, event, cmdArgs);
      }
    } catch (e) {
      if (triggered === CALENDAR_TRIGGER) {
        this.logger.debug('calendar command failed with an internal error');
        await this.replyCalendarError(roomId, event, 'failed');
        return;
      }
      if (e instanceof TranslatableError) {
        this.logger.debug(
          `TranslatableError errorKey: ${e.errorKey} commandName: ${commandName}`,
        );
        await this.replyWithError(
          roomId,
          event,
          e.errorKey,
          e.translationParams,
        );
      } else if (e instanceof Error) {
        this.logger.debug(
          `commandErrors.generic commandName: ${commandName} error: ${e.message}`,
        );
        await this.replyWithError(roomId, event, 'commandErrors.generic', {
          message: e.message,
        });
      } else {
        this.logger.debug(
          `commandErrors.generic commandName: ${commandName} error: ${e}`,
        );
        await this.replyWithError(roomId, event, 'commandErrors.generic', {
          message: 'internal error',
        });
      }
    }
  }

  private async processCalendarCommand(
    commandText: string,
    roomId: string,
    event: IRoomEvent<MessageEventContent>,
  ) {
    if (!(await this.isCalendarRoomSafeToSend(roomId))) {
      return;
    }

    const [commandName, ...extraArgs] = commandText.split(/\s+/);
    if (commandName === 'help' && extraArgs.length === 0) {
      const lng: string = await this.detectLocale(roomId);
      const text: string = i18next.t('calendarCommandHelp', {
        lng,
        joinArrays: '\n',
      });
      await this.sendCalendarReply(roomId, event, text);
      return;
    }
    if (commandName === 'help') {
      await this.replyCalendarError(roomId, event, 'badSyntax');
      return;
    }

    const lng: string = await this.detectLocale(roomId);
    /*
     * IMPORTANT: These keys are translated by CalendarCommandService and are
     * listed here for i18next-cli extraction.
     * t('calendarCommandReplies.upcoming')
     * t('calendarCommandReplies.noUpcoming')
     * t('calendarCommandReplies.upcomingPartial')
     * t('calendarCommandReplies.eventDetails')
     * t('calendarCommandReplies.eventCreated', { resourceId })
     * t('calendarCommandReplies.eventDeleted', { resourceId })
     * t('calendarCommandReplies.idLabel')
     * t('calendarCommandReplies.titleLabel')
     * t('calendarCommandReplies.whenLabel')
     * t('calendarCommandReplies.descriptionLabel')
     * t('calendarCommandReplies.untitled')
     * t('calendarCommandReplies.timeUnavailable')
     */
    const text = await this.calendarCommandService.execute(
      roomId,
      event.sender,
      commandText,
      (key, parameters) =>
        i18next.t(key, { lng, ...parameters }) as unknown as string,
    );
    await this.sendCalendarReply(roomId, event, text);
  }

  private async processCommand(
    commandName: string,
    roomId: string,
    event: IRoomEvent<MessageEventContent>,
    cmdArgs: string[],
  ) {
    const sender = event.sender;
    this.logger.debug(`${sender} is running command: ${commandName}`);

    if (HELP_COMMANDS.includes(commandName)) {
      const { displayname: botDisplayName } =
        await this.matrixClient.getUserProfile(this.botUserId);
      const lng: string = await this.detectLocale(roomId);

      const html: string = i18next.t('commandHelp', {
        lng,
        botDisplayName,
        joinArrays: '',
      });
      await this.matrixClient.sendHtmlText(roomId, html);
    } else if (LANG_COMMANDS.includes(commandName)) {
      await this.welcomeWorkflowService.handleLanguageChange(roomId, cmdArgs);
    } else if (SETUP_COMMANDS.includes(commandName)) {
      await this.welcomeWorkflowService.handleAddWidgetCommand(roomId);
    } else if (STATUS_COMMANDS.includes(commandName)) {
      await this.welcomeWorkflowService.handleStatusCommand(roomId);
    } else {
      this.logger.verbose(
        `commandErrors.badCommand commandName: ${commandName}`,
      );
      await this.replyWithError(roomId, event, 'commandErrors.badCommand', {
        trigger: TRIGGER,
      });
    }
  }

  private async replyWithError(
    roomId: string,
    event: any,
    errorKey: string,
    params: any,
  ) {
    const lng: string = await this.detectLocale(roomId);
    /*
     * IMPORTANT: This comment defines the keys used for this function and is used to extract them via i18next-parser
     *
     * t('commandErrors.noCommandProvided', 'No command provided, try <code>{{trigger}} help</code>')
     * t('commandErrors.generic', 'There was an error processing your command: {{message}}')
     * t('commandErrors.badCommand', 'Bad command, try <code>{{trigger}} help</code>')
     *
     */
    // TODO: fix the types of i18next
    const text: string = i18next.t(errorKey, {
      lng,
      ...params,
    }) as unknown as string;
    this.logger.debug(`Replying with command error category: ${errorKey}`);
    await this.matrixClient.replyText(roomId, event, text, text);
  }

  private async replyCalendarError(
    roomId: string,
    event: IRoomEvent<MessageEventContent>,
    errorKey:
      | 'badSyntax'
      | 'notAllowed'
      | 'disabled'
      | 'writesDisabled'
      | 'notFound'
      | 'conflict'
      | 'unsafe'
      | 'failed',
  ) {
    const lng = await this.detectLocale(roomId);
    /*
     * IMPORTANT: These static keys are extracted by i18next-cli.
     * t('calendarCommandErrors.badSyntax')
     * t('calendarCommandErrors.notAllowed')
     * t('calendarCommandErrors.disabled')
     * t('calendarCommandErrors.writesDisabled')
     * t('calendarCommandErrors.notFound')
     * t('calendarCommandErrors.conflict')
     * t('calendarCommandErrors.unsafe')
     * t('calendarCommandErrors.failed')
     */
    const text = i18next.t(`calendarCommandErrors.${errorKey}`, {
      lng,
    }) as unknown as string;
    this.logger.debug(`Replying with calendar error category: ${errorKey}`);
    await this.sendCalendarReply(roomId, event, text);
  }

  private async sendCalendarReply(
    roomId: string,
    event: IRoomEvent<MessageEventContent>,
    text: string,
  ): Promise<void> {
    // The room can become encrypted while CalDAV work is in flight. Recheck
    // current state immediately before sending, then keep the SDK's encrypted
    // send path and emit plain text with explicit empty mention metadata.
    if (!(await this.isCalendarRoomSafeToSend(roomId))) {
      return;
    }

    const replyRelation =
      typeof event.event_id === 'string' && event.event_id.length > 0
        ? {
            'm.relates_to': {
              'm.in_reply_to': { event_id: event.event_id },
            },
          }
        : {};
    await this.matrixClient.sendMessage(roomId, {
      msgtype: 'm.text',
      body: text,
      'm.mentions': {},
      ...replyRelation,
    });
  }

  private async isCalendarRoomSafeToSend(roomId: string): Promise<boolean> {
    let encryptionEvent: unknown;
    try {
      encryptionEvent = await this.matrixClient.getRoomStateEvent(
        roomId,
        'm.room.encryption',
        '',
      );
    } catch (error) {
      // Only the homeserver's exact not-found response proves this room has no
      // encryption state. Any other lookup failure is unknown and fails closed.
      return isMissingEncryptionState(error);
    }

    if (
      encryptionEvent === null ||
      typeof encryptionEvent !== 'object' ||
      typeof (encryptionEvent as { algorithm?: unknown }).algorithm !==
        'string' ||
      !(encryptionEvent as { algorithm: string }).algorithm
    ) {
      return false;
    }

    if (this.appConfig.enable_crypto !== true) {
      return false;
    }

    try {
      const crypto = this.matrixClient.crypto;
      return crypto ? await crypto.isRoomEncrypted(roomId) : false;
    } catch {
      return false;
    }
  }

  // detects the locale in the private room, or returns default
  private async detectLocale(roomId: string): Promise<string> {
    try {
      // TODO: extract this into a common service or cache
      const ctx = await this.matrixClient.getRoomStateEvent(
        roomId,
        StateEventName.NIC_MEETINGS_WELCOME_ROOM,
        this.botUserId,
      );
      return ctx?.locale ?? this.appConfig.welcome_workflow_default_locale;
    } catch (e) {
      this.logger.warn(
        `Can't detect locale in room: ${roomId} using ${StateEventName.NIC_MEETINGS_WELCOME_ROOM} event.`,
      );
    }
    // default
    return this.appConfig.welcome_workflow_default_locale;
  }
}

function isMissingEncryptionState(error: unknown): boolean {
  return (
    error instanceof MatrixError &&
    error.statusCode === 404 &&
    error.errcode === 'M_NOT_FOUND'
  );
}
