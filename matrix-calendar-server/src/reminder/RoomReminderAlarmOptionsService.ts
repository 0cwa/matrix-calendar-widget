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

import type { CalendarEventDuration } from '@matrix-calendar-widget/calendar';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { enumerateCanonicalReminderResourceSelections } from './CanonicalReminderIdentityResolver';
import { resolveTriggerableReminderAlarmOption } from './ReminderConfigurationSourceValidator';
import { RoomReminderConfigurationService } from './RoomReminderConfigurationService';

export type RoomReminderAlarmOption = {
  eventUid: string;
  recurrenceId: string | null;
  alarmUid: string;
  relatedTo: 'start' | 'end';
  trigger: CalendarEventDuration;
  repeat?: {
    count: number;
    interval: CalendarEventDuration;
  };
};

export type RoomReminderAlarmOptionsResponse = {
  options: RoomReminderAlarmOption[];
};

/**
 * Lists only stable, currently triggerable DISPLAY alarm metadata. Current
 * room authorization, feature gates, the bound source read, and the source
 * response limit stay in RoomReminderConfigurationService.
 */
export class RoomReminderAlarmOptionsService {
  constructor(
    private readonly configurations: RoomReminderConfigurationService,
  ) {}

  async list(
    actorUserId: unknown,
    roomId: unknown,
    eventId: unknown,
  ): Promise<RoomReminderAlarmOptionsResponse> {
    try {
      const resource = await this.configurations.readSourceForAlarmOptions(
        actorUserId,
        roomId,
        eventId,
      );
      const selections = enumerateCanonicalReminderResourceSelections(resource);
      const options: RoomReminderAlarmOption[] = [];
      for (const selection of selections) {
        const option = resolveTriggerableReminderAlarmOption(selection);
        if (option) options.push(option);
      }
      return { options };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw unavailable();
    }
  }
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'room-reminder-options-unavailable',
    message: 'Room reminder alarm options are unavailable',
  });
}
