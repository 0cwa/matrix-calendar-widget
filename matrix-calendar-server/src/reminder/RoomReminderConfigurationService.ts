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
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserID } from 'matrix-bot-sdk';
import { IAppConfiguration } from '../IAppConfiguration';
import { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import { resolveRoomCalendarBinding } from '../service/RoomCalendarBindingResolver';
import {
  RoomCalendarCalDavAccess,
  RoomCalendarTarget,
} from '../service/RoomCalendarCalDavAccess';
import { RoomCalendarEventOperations } from '../service/RoomCalendarEventOperations';
import { CanonicalReminderResourceData } from './CanonicalReminderIdentityResolver';
import { resolveTriggerableReminderIdentity } from './ReminderConfigurationSourceValidator';
import {
  RoomMentionMatrixState,
  authorizeRoomMentionScheduling,
} from './RoomMentionPolicy';
import {
  RoomReminderConfigurationIdentity,
  assertReminderConfigurationCursorScope,
  assertReminderConfigurationIdentity,
  encodeReminderConfigurationCursor,
  parseReminderConfigurationCursor,
  parseReminderConfigurationDeleteInput,
  parseReminderConfigurationEventId,
  parseReminderConfigurationPageSize,
  parseReminderConfigurationUpsertInput,
} from './RoomReminderConfigurationContract';
import {
  RoomReminderConfiguration,
  RoomReminderStore,
} from './RoomReminderStore';

export type RoomReminderConfigurationPage = {
  items: RoomReminderConfigurationIdentity[];
  nextCursor?: string;
};

/**
 * Actor-facing configuration only. This service never sends messages and does
 * not expose event text or raw iCalendar source in its return values.
 */
export class RoomReminderConfigurationService {
  constructor(
    private readonly appConfig: IAppConfiguration,
    private readonly store: RoomReminderStore,
    private readonly matrixState: RoomMentionMatrixState,
    private readonly roomCalendarAccess: RoomCalendarCalDavAccess,
    private readonly eventResources: RoomCalendarEventOperations,
  ) {}

  /**
   * Internal source handoff for the separately bounded alarm-options endpoint.
   * This returns raw canonical ICS only to server-side code after the same
   * actor, membership, power, binding, and read-proof checks as configuration.
   * Never return its result from a controller or log it.
   */
  async readSourceForAlarmOptions(
    actorUserId: unknown,
    roomId: unknown,
    eventId: unknown,
  ): Promise<CanonicalReminderResourceData> {
    this.assertEnabled();
    const safeEventId = parseReminderConfigurationEventId(eventId);
    const actor = requireCanonicalActor(actorUserId);
    const target = await this.authorize(actor, roomId);
    return this.readSourceForTarget(target, safeEventId);
  }

  async list(
    actorUserId: unknown,
    roomId: unknown,
    rawPageSize: unknown,
    rawCursor: unknown,
  ): Promise<RoomReminderConfigurationPage> {
    this.assertEnabled();
    const actor = requireCanonicalActor(actorUserId);
    const target = await this.authorize(actor, roomId);
    const pageSize = parseReminderConfigurationPageSize(rawPageSize);
    const cursor = parseReminderConfigurationCursor(rawCursor);
    assertReminderConfigurationCursorScope(
      cursor,
      target.roomId,
      target.calendarId,
    );

    let rows: RoomReminderConfiguration[];
    try {
      rows = await this.store.listConfigurationPage(
        target.roomId,
        target.calendarId,
        cursor
          ? {
              eventUid: cursor.eventUid,
              recurrenceId: cursor.recurrenceId,
              alarmUid: cursor.alarmUid,
            }
          : undefined,
        pageSize,
      );
    } catch {
      throw unavailable();
    }

    if (
      !Array.isArray(rows) ||
      rows.length > pageSize ||
      rows.some(
        (row) =>
          row.roomId !== target.roomId || row.calendarId !== target.calendarId,
      )
    ) {
      throw unavailable();
    }

    let items: RoomReminderConfigurationIdentity[];
    try {
      items = rows.map((row) => publicIdentity(row));
    } catch {
      throw unavailable();
    }
    const last = rows.at(-1);
    return {
      items,
      ...(rows.length === pageSize && last
        ? {
            nextCursor: encodeReminderConfigurationCursor(
              target.roomId,
              target.calendarId,
              last,
            ),
          }
        : {}),
    };
  }

  async upsert(
    actorUserId: unknown,
    roomId: unknown,
    body: unknown,
  ): Promise<RoomReminderConfigurationIdentity> {
    this.assertEnabled();
    const input = parseReminderConfigurationUpsertInput(body);
    const actor = requireCanonicalActor(actorUserId);
    const target = await this.authorize(actor, roomId);
    const identity = await this.resolveSourceIdentity(target, input);

    try {
      await this.store.upsertConfiguration({
        roomId: target.roomId,
        calendarId: target.calendarId,
        ...identity,
      });
    } catch {
      throw unavailable();
    }
    return publicIdentity(identity);
  }

  async delete(
    actorUserId: unknown,
    roomId: unknown,
    body: unknown,
  ): Promise<{ deleted: true }> {
    this.assertEnabled();
    const identity = parseReminderConfigurationDeleteInput(body);
    const actor = requireCanonicalActor(actorUserId);
    const target = await this.authorize(actor, roomId);

    try {
      await this.store.deleteConfiguration({
        roomId: target.roomId,
        calendarId: target.calendarId,
        ...identity,
      });
    } catch {
      throw unavailable();
    }
    return { deleted: true };
  }

  private assertEnabled(): void {
    if (
      !this.appConfig.room_reminder_configuration_enabled ||
      !this.appConfig.room_calendar_access_enabled ||
      !this.store.enabled
    ) {
      throw unavailable();
    }
  }

  private async authorize(
    actorUserId: string,
    roomId: unknown,
  ): Promise<RoomCalendarTarget> {
    if (typeof roomId !== 'string') {
      throw new ForbiddenException('Not permitted to manage reminders');
    }

    let binding: RoomCalendarBinding;
    try {
      binding = resolveRoomCalendarBinding(
        this.appConfig.room_calendar_bindings,
        roomId,
      );
    } catch {
      throw new ForbiddenException('Not permitted to manage reminders');
    }

    const authorizedBinding = await authorizeRoomMentionScheduling(
      {
        authenticatedActorUserId: actorUserId,
        roomId: binding.roomId,
        calendarId: binding.calendarId,
        configuredBindings: this.appConfig.room_calendar_bindings,
      },
      this.matrixState,
    );
    if (!authorizedBinding) {
      throw new ForbiddenException('Not permitted to manage reminders');
    }

    return {
      roomId: authorizedBinding.roomId,
      calendarId: authorizedBinding.calendarId,
      principal: { kind: 'service' },
    };
  }

  private async resolveSourceIdentity(
    target: RoomCalendarTarget,
    input: { eventId: string; recurrenceId: string | null; alarmUid: string },
  ): Promise<RoomReminderConfigurationIdentity> {
    const resource = await this.readSourceForTarget(target, input.eventId);

    let identity: ReturnType<typeof resolveTriggerableReminderIdentity>;
    try {
      identity = resolveTriggerableReminderIdentity(
        {
          calendarId: target.calendarId,
          recurrenceId: input.recurrenceId,
          alarmUid: input.alarmUid,
        },
        resource,
      );
    } catch {
      throw new BadRequestException({
        code: 'room-reminder-source-unsupported',
        message: 'Event reminder source is not supported',
      });
    }
    return publicIdentity(identity);
  }

  private async readSourceForTarget(
    target: RoomCalendarTarget,
    eventId: string,
  ): Promise<CanonicalReminderResourceData> {
    try {
      // The current widget actor has already passed current membership, power,
      // and exact-binding checks. The only credential used for DAV is the
      // server-configured application-service principal.
      const servicePrincipal =
        await this.roomCalendarAccess.forAuthorizedTarget(target, 'read');
      const current = await this.eventResources.getEventResource(
        { target, servicePrincipal },
        eventId,
      );
      return {
        calendarId: target.calendarId,
        icalendar: current.icalendar,
      };
    } catch {
      throw unavailable();
    }
  }
}

function requireCanonicalActor(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new UnauthorizedException('Matrix user identity is unavailable');
  }

  try {
    const separator = value.indexOf(':');
    const parsed = new UserID(value);
    if (
      !value.startsWith('@') ||
      separator <= 1 ||
      separator === value.length - 1 ||
      !parsed.localpart ||
      !parsed.domain ||
      value.slice(1, separator) !== parsed.localpart ||
      value.slice(separator + 1) !== parsed.domain
    ) {
      throw new Error('Invalid Matrix user ID');
    }
  } catch {
    throw new UnauthorizedException('Matrix user identity is unavailable');
  }
  return value;
}

function publicIdentity(
  identity: Pick<
    RoomReminderConfiguration,
    'eventUid' | 'recurrenceId' | 'alarmUid'
  >,
): RoomReminderConfigurationIdentity {
  assertReminderConfigurationIdentity(identity);
  return {
    eventUid: identity.eventUid,
    recurrenceId: identity.recurrenceId,
    alarmUid: identity.alarmUid,
  };
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'room-reminder-configuration-unavailable',
    message: 'Room reminder configuration is unavailable',
  });
}
