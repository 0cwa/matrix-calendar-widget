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

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import { RoomReminderConfiguration, RoomReminderStore } from '../reminder';
import { MatrixCalendarAuthorizationFactory } from './MatrixCalendarAuthorization';
import {
  resolveRoomCalendarBinding,
  RoomCalendarBindingError,
} from './RoomCalendarBindingResolver';

export type RoomReminderIdentity = {
  eventUid: string;
  /** `null` identifies the master; otherwise use the widget's canonical JSON recurrence key. */
  recurrenceId: string | null;
  /** RFC 9074 UID from the selected VALARM component. */
  alarmUid: string;
};

@Injectable()
/**
 * Persists inert room reminder intent. This service does not resolve the event
 * or alarm in CalDAV; a future scheduler must resolve the canonical VEVENT,
 * recurrence identity, and VALARM UID before sending a reminder.
 */
export class RoomReminderConfigurationService {
  constructor(
    @Inject(ModuleProviderToken.APP_CONFIGURATION)
    private readonly appConfig: IAppConfiguration,
    private readonly authorizationFactory: MatrixCalendarAuthorizationFactory,
    @Inject(ModuleProviderToken.ROOM_REMINDER_STORE)
    private readonly reminderStore: RoomReminderStore,
  ) {}

  async list(
    actorId: string,
    roomId: string,
  ): Promise<RoomReminderConfiguration[]> {
    const binding = await this.authorizedBinding(
      actorId,
      roomId,
      'read-events',
    );
    this.requireEnabledStore();
    return this.reminderStore.listConfigurations(roomId, binding.calendarId);
  }

  async put(
    actorId: string,
    roomId: string,
    identity: RoomReminderIdentity,
  ): Promise<RoomReminderConfiguration> {
    const binding = await this.authorizedBinding(
      actorId,
      roomId,
      'update-event',
      identity.eventUid,
    );
    this.requireEnabledStore();
    const configuration: RoomReminderConfiguration = {
      roomId,
      calendarId: binding.calendarId,
      ...identity,
    };
    await this.reminderStore.upsertConfiguration(configuration);
    return configuration;
  }

  async delete(
    actorId: string,
    roomId: string,
    identity: RoomReminderIdentity,
  ): Promise<void> {
    const binding = await this.authorizedBinding(
      actorId,
      roomId,
      'update-event',
      identity.eventUid,
    );
    this.requireEnabledStore();
    await this.reminderStore.deleteConfiguration({
      roomId,
      calendarId: binding.calendarId,
      ...identity,
    });
  }

  private async authorizedBinding(
    actorId: string,
    roomId: string,
    action: 'read-events' | 'update-event',
    eventUid?: string,
  ) {
    const authorization = this.authorizationFactory.forRoom(actorId, roomId);
    if (!(await authorization.isAllowed({ action: 'list-calendars' }))) {
      throw new ForbiddenException(
        'Not allowed to access calendars for this Matrix room',
      );
    }

    const binding = this.resolveBinding(roomId);
    const allowed = await authorization.isAllowed(
      action === 'read-events'
        ? { action, calendarId: binding.calendarId }
        : {
            action,
            calendarId: binding.calendarId,
            eventId: eventUid!,
          },
    );
    if (!allowed) {
      throw new ForbiddenException(
        `Not allowed to ${action} for this Matrix room`,
      );
    }
    return binding;
  }

  private resolveBinding(roomId: string) {
    try {
      return resolveRoomCalendarBinding(
        this.appConfig.room_calendar_bindings,
        roomId,
      );
    } catch (error) {
      if (!(error instanceof RoomCalendarBindingError)) {
        throw error;
      }
      switch (error.code) {
        case 'invalid_room_id':
          throw new BadRequestException({
            code: 'invalid-room-id',
            message: 'Matrix room identifier is invalid',
          });
        case 'missing_binding':
          throw new NotFoundException({
            code: 'room-calendar-binding-missing',
            message: 'No calendar is configured for this Matrix room',
          });
        default:
          throw new ServiceUnavailableException({
            code: 'room-calendar-binding-invalid',
            message: 'Room calendar configuration is invalid',
          });
      }
    }
  }

  private requireEnabledStore(): void {
    if (!this.reminderStore.enabled) {
      throw new ServiceUnavailableException({
        code: 'room-reminders-disabled',
        message: 'Room reminder configuration is not enabled',
      });
    }
  }
}
