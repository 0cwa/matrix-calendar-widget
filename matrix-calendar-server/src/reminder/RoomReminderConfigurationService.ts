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
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserID } from 'matrix-bot-sdk';
import { IAppConfiguration } from '../IAppConfiguration';
import type { RoomCalendarBindingRegistry } from '../service/IRoomCalendarBindingRegistry';
import {
  RoomCalendarCalDavAccess,
  RoomCalendarTarget,
} from '../service/RoomCalendarCalDavAccess';
import { RoomCalendarEventOperations } from '../service/RoomCalendarEventOperations';
import { CanonicalReminderResourceData } from './CanonicalReminderIdentityResolver';
import { resolveTriggerableReminderConfiguration } from './ReminderConfigurationSourceValidator';
import {
  RoomMentionMatrixState,
  RoomMentionRecipient,
  authorizeRoomMentionScheduling,
  normalizeRoomMentionDisplayName,
} from './RoomMentionPolicy';
import {
  RoomReminderConfigurationRecord,
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
  normalizeRoomReminderConfiguration,
} from './RoomReminderStore';

export type RoomReminderConfigurationPage = {
  items: RoomReminderConfigurationRecord[];
  nextCursor?: string;
};

export type RoomReminderRecipientsResponse = Readonly<{
  recipients: readonly RoomMentionRecipient[];
}>;

const MAX_ROOM_REMINDER_RECIPIENTS = 20_000;

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
    private readonly bindingRegistry: RoomCalendarBindingRegistry,
    private readonly now: () => number = Date.now,
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

    let items: RoomReminderConfigurationRecord[];
    try {
      items = rows.map((row) => publicConfiguration(row));
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

  async listRecipients(
    actorUserId: unknown,
    roomId: unknown,
  ): Promise<RoomReminderRecipientsResponse> {
    this.assertEnabled();
    const actor = requireCanonicalActor(actorUserId);
    const target = await this.authorize(actor, roomId);
    const getRecipients = this.matrixState.getJoinedRoomRecipients;
    if (typeof getRecipients !== 'function') throw unavailable();

    try {
      const rows = await getRecipients.call(this.matrixState, target.roomId);
      if (!Array.isArray(rows) || rows.length > MAX_ROOM_REMINDER_RECIPIENTS) {
        throw new Error('invalid roster');
      }

      const seen = new Set<string>();
      const recipients = rows.map((row) => {
        if (
          !row ||
          !isCanonicalMatrixUserId(row.userId) ||
          seen.has(row.userId)
        ) {
          throw new Error('invalid roster');
        }
        seen.add(row.userId);
        return {
          userId: row.userId,
          displayName: normalizeRoomMentionDisplayName(row.displayName),
        };
      });
      return { recipients };
    } catch {
      throw unavailable();
    }
  }

  async upsert(
    actorUserId: unknown,
    roomId: unknown,
    body: unknown,
  ): Promise<RoomReminderConfigurationRecord> {
    this.assertEnabled();
    const input = parseReminderConfigurationUpsertInput(body);
    const actor = requireCanonicalActor(actorUserId);
    const target = await this.authorize(actor, roomId);
    await this.assertSelectedRecipientsAreJoined(target.roomId, input.target);
    const resolution = await this.resolveSourceConfiguration(target, input);
    const configurationIdentity = {
      roomId: target.roomId,
      calendarId: target.calendarId,
      eventUid: resolution.identity.eventUid,
      recurrenceId: resolution.identity.recurrenceId,
      alarmUid: resolution.identity.alarmUid,
    };

    let expectedCurrent: RoomReminderConfiguration | undefined;
    try {
      expectedCurrent = await this.store.getConfiguration(
        configurationIdentity,
      );
    } catch {
      throw unavailable();
    }
    const allDayScheduleChanged =
      expectedCurrent === undefined ||
      !sameAllDayReminderSchedule(
        expectedCurrent.allDaySchedule,
        input.allDaySchedule,
      );
    if (
      allDayScheduleChanged &&
      resolution.allDayReminderDueAt &&
      !resolution.isRecurringSeries &&
      resolution.allDayReminderDueAt.getTime() <= this.now()
    ) {
      throw new BadRequestException({
        code: 'room-reminder-time-in-past',
        message: 'Choose a future Matrix reminder time before saving',
      });
    }

    let stored: boolean;
    try {
      stored = await this.store.compareAndUpsertConfiguration(
        {
          ...configurationIdentity,
          target: input.target,
          allDaySchedule: input.allDaySchedule,
        },
        expectedCurrent,
      );
    } catch {
      throw unavailable();
    }
    if (!stored) {
      throw new ConflictException({
        code: 'room-reminder-configuration-changed',
        message: 'Reminder settings changed while saving. Reload and try again',
      });
    }
    try {
      const current = await this.store.getConfiguration(configurationIdentity);
      if (!current) throw new Error('Reminder configuration was not stored');
      return publicConfiguration(current);
    } catch {
      throw unavailable();
    }
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

    const bindingRegistry = this.bindingRegistry;

    const authorizedBinding = await authorizeRoomMentionScheduling(
      {
        authenticatedActorUserId: actorUserId,
        roomId,
        resolveBinding: (signal) =>
          bindingRegistry.resolve(roomId, undefined, signal),
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

  private async resolveSourceConfiguration(
    target: RoomCalendarTarget,
    input: {
      eventId: string;
      recurrenceId: string | null;
      alarmUid: string;
      allDaySchedule: RoomReminderConfiguration['allDaySchedule'];
    },
  ): Promise<ReturnType<typeof resolveTriggerableReminderConfiguration>> {
    const resource = await this.readSourceForTarget(target, input.eventId);

    let resolution: ReturnType<typeof resolveTriggerableReminderConfiguration>;
    try {
      resolution = resolveTriggerableReminderConfiguration(
        {
          calendarId: target.calendarId,
          recurrenceId: input.recurrenceId,
          alarmUid: input.alarmUid,
        },
        resource,
        input.allDaySchedule,
      );
    } catch {
      throw new BadRequestException({
        code: 'room-reminder-source-unsupported',
        message: 'Event reminder source is not supported',
      });
    }
    return resolution;
  }

  private async assertSelectedRecipientsAreJoined(
    roomId: string,
    target: RoomReminderConfiguration['target'],
  ): Promise<void> {
    if (!target || target.kind !== 'users') return;
    let joined: readonly string[];
    try {
      joined = await this.matrixState.getJoinedRoomMembers(roomId);
    } catch {
      throw unavailable();
    }
    if (target.userIds.some((userId) => !joined.includes(userId))) {
      throw new BadRequestException({
        code: 'room-reminder-recipient-not-joined',
        message: 'Selected recipients must be joined room members',
      });
    }
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

function isCanonicalMatrixUserId(value: unknown): value is string {
  return typeof value === 'string' && /^@[^\s:#?]+:[^\s?#]+$/.test(value);
}

function publicConfiguration(
  configuration: RoomReminderConfiguration,
): RoomReminderConfigurationRecord {
  assertReminderConfigurationIdentity(configuration);
  const normalized = normalizeRoomReminderConfiguration(configuration);
  return {
    eventUid: configuration.eventUid,
    recurrenceId: configuration.recurrenceId,
    alarmUid: configuration.alarmUid,
    target: normalized.target,
    allDaySchedule: normalized.allDaySchedule,
    revision: normalized.revision,
  };
}

function sameAllDayReminderSchedule(
  left: RoomReminderConfiguration['allDaySchedule'],
  right: RoomReminderConfiguration['allDaySchedule'],
): boolean {
  const normalizedLeft = left ?? null;
  const normalizedRight = right ?? null;
  return normalizedLeft === null
    ? normalizedRight === null
    : normalizedRight !== null &&
        normalizedLeft.daysBefore === normalizedRight.daysBefore &&
        normalizedLeft.localTime === normalizedRight.localTime &&
        normalizedLeft.timezone === normalizedRight.timezone;
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'room-reminder-configuration-unavailable',
    message: 'Room reminder configuration is unavailable',
  });
}
