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

import { randomUUID } from 'node:crypto';
import type {
  RoomCalendarBindingRecord,
  RoomCalendarBindingReservationResult,
  RoomCalendarBindingStore,
} from '../model/IRoomCalendarBindingStore';
import type { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import type { RoomCalendarBindingRegistry } from './IRoomCalendarBindingRegistry';
import { parseRoomCalendarServiceUserId } from './RoomCalendarCalDavAccess';
import { isMatrixRoomV12Creator } from './MatrixCalendarAuthorization';
import { isMatrixServerName } from './MatrixIdentifiers';
import type {
  RoomCalendarSetupRequest,
  RoomCalendarSetupResult,
  RoomCalendarSetupService,
} from './IRoomCalendarSetupService';
import {
  isRoomConfirmedUnencrypted,
  isTrustedMatrixMissingStateError,
} from './MatrixRoomEncryptionState';
import type {
  RoomCalendarSetupAuthorizationPort,
  RoomCalendarSetupCalDavMode,
  RoomCalendarSetupCalDavPort,
  RoomCalendarSetupConfiguration,
  RoomCalendarSetupMatrixPreconditionsPort,
  RoomCalendarSetupWidgetPort,
} from './RoomCalendarSetupPorts';

const GENERATED_CALENDAR_ID =
  /^calendar-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Orchestrates the authorized, append-only room setup workflow. All Matrix
 * checks precede the registry/store, OpenID, CalDAV, and widget operations.
 */
export class MatrixRoomCalendarSetupService implements RoomCalendarSetupService {
  constructor(
    private readonly configuration: RoomCalendarSetupConfiguration,
    private readonly authorization: RoomCalendarSetupAuthorizationPort,
    private readonly matrixClient: RoomCalendarSetupMatrixPreconditionsPort,
    private readonly botUserId: string,
    private readonly registry: RoomCalendarBindingRegistry,
    private readonly bindingStore: RoomCalendarBindingStore,
    private readonly caldav: RoomCalendarSetupCalDavPort,
    private readonly widget: RoomCalendarSetupWidgetPort,
    private readonly makeUuid: () => string = randomUUID,
  ) {}

  async setup(
    request: RoomCalendarSetupRequest,
  ): Promise<RoomCalendarSetupResult> {
    if (!this.configuration.enabled) return { status: 'disabled' };

    if (!this.isAllowedActorServer(request.actorUserId)) {
      return { status: 'not-authorized' };
    }

    let isManager: boolean;
    try {
      isManager = await this.authorization.canManageCalendars(
        request.actorUserId,
        request.roomId,
      );
    } catch {
      isManager = false;
    }
    if (!isManager) return { status: 'not-authorized' };

    if (
      !(await isRoomConfirmedUnencrypted(this.matrixClient, request.roomId))
    ) {
      return { status: 'unsupported-room' };
    }

    const botStatus = await this.checkBotWritePower(request.roomId);
    if (botStatus) return { status: botStatus };

    let widgetPreflight: Awaited<
      ReturnType<RoomCalendarSetupWidgetPort['preflight']>
    >;
    try {
      widgetPreflight = await this.widget.preflight(request.roomId);
    } catch {
      return { status: 'unavailable' };
    }
    if (widgetPreflight === 'conflict') return { status: 'conflict' };
    if (widgetPreflight === 'unavailable') return { status: 'unavailable' };

    let snapshot: readonly RoomCalendarBinding[];
    try {
      // Validates the complete static plus pending/ready dynamic set and its
      // total cap before setup uses any binding or asks for CalDAV proof.
      snapshot = await this.registry.getSnapshot();
    } catch {
      return { status: 'unavailable' };
    }

    const staticBinding = this.configuration.staticBindings.find(
      (binding) => binding.roomId === request.roomId,
    );
    if (staticBinding) {
      const snapshotBinding = snapshot.find(
        (binding) => binding.roomId === request.roomId,
      );
      if (!sameBinding(snapshotBinding, staticBinding)) {
        return { status: 'conflict' };
      }
      return this.finishBinding(staticBinding, 'verify-only', false);
    }

    const readyDynamicBinding = snapshot.find(
      (binding) => binding.roomId === request.roomId,
    );
    if (readyDynamicBinding) {
      if (!isGeneratedCalendarId(readyDynamicBinding.calendarId)) {
        return { status: 'conflict' };
      }
      return this.finishBinding(readyDynamicBinding, 'verify-only', false);
    }

    if (!this.bindingStore.enabled) return { status: 'unavailable' };

    const candidate: RoomCalendarBinding = {
      roomId: request.roomId,
      calendarId: `calendar-${this.makeUuid()}`,
    };
    if (!isGeneratedCalendarId(candidate.calendarId)) {
      return { status: 'unavailable' };
    }

    let reservation: RoomCalendarBindingReservationResult;
    try {
      reservation = await this.bindingStore.reserve({
        binding: candidate,
        staticBindings: this.configuration.staticBindings,
        createdBy: request.actorUserId,
        createdAt: new Date(),
      });
    } catch {
      return { status: 'unavailable' };
    }

    switch (reservation.kind) {
      case 'static-conflict':
      case 'collection-conflict':
        return { status: 'conflict' };
      case 'capacity-reached':
        return { status: 'capacity-reached' };
      case 'reserved':
      case 'existing':
        return this.finishReservation(
          request.roomId,
          reservation,
        );
    }
  }

  private async finishReservation(
    roomId: string,
    reservation: Extract<
      RoomCalendarBindingReservationResult,
      { kind: 'reserved' | 'existing' }
    >,
  ): Promise<RoomCalendarSetupResult> {
    const record = reservation.record;
    if (
      record.roomId !== roomId ||
      !isGeneratedCalendarId(record.calendarId) ||
      (record.status !== 'pending' && record.status !== 'ready')
    ) {
      return { status: 'conflict' };
    }

    const binding = {
      roomId: record.roomId,
      calendarId: record.calendarId,
    };
    const mode: RoomCalendarSetupCalDavMode =
      record.status === 'pending' ? 'create-if-missing' : 'verify-only';
    return this.finishBinding(binding, mode, record.status === 'pending');
  }

  private async finishBinding(
    binding: RoomCalendarBinding,
    mode: RoomCalendarSetupCalDavMode,
    dynamicPending: boolean,
  ): Promise<RoomCalendarSetupResult> {
    let widgetPreflight: Awaited<
      ReturnType<RoomCalendarSetupWidgetPort['preflight']>
    >;
    try {
      widgetPreflight = await this.widget.preflight(
        binding.roomId,
        binding.calendarId,
      );
    } catch {
      return { status: dynamicPending ? 'pending' : 'widget-pending' };
    }
    if (widgetPreflight === 'conflict') return { status: 'conflict' };
    if (widgetPreflight === 'unavailable') {
      return { status: dynamicPending ? 'pending' : 'widget-pending' };
    }

    let caldavOutcome: Awaited<ReturnType<RoomCalendarSetupCalDavPort['reconcile']>>;
    try {
      caldavOutcome = await this.caldav.reconcile(binding, mode);
    } catch {
      return { status: dynamicPending ? 'pending' : 'unavailable' };
    }

    if (caldavOutcome === 'conflict') return { status: 'conflict' };
    if (caldavOutcome === 'missing') {
      return { status: dynamicPending ? 'pending' : 'conflict' };
    }
    if (mode === 'verify-only' && caldavOutcome === 'created') {
      return { status: 'conflict' };
    }

    if (dynamicPending) {
      try {
        const readyRecord = await this.bindingStore.markReady(
          binding,
          new Date(),
        );
        if (!isExactReadyRecord(readyRecord, binding)) {
          return { status: 'pending' };
        }
      } catch {
        return { status: 'pending' };
      }
    }

    let widgetOutcome: Awaited<ReturnType<RoomCalendarSetupWidgetPort['install']>>;
    try {
      widgetOutcome = await this.widget.install(binding);
    } catch {
      return { status: 'widget-pending' };
    }
    if (widgetOutcome === 'conflict') return { status: 'conflict' };
    if (widgetOutcome === 'unavailable') return { status: 'widget-pending' };

    if (caldavOutcome === 'created') return { status: 'created' };
    return { status: 'already-ready' };
  }

  private async checkBotWritePower(
    roomId: string,
  ): Promise<'bot-not-ready' | 'widget-power-required' | undefined> {
    let members: readonly string[];
    try {
      members = await this.matrixClient.getJoinedRoomMembers(roomId);
    } catch {
      return 'bot-not-ready';
    }
    if (!Array.isArray(members) || !members.includes(this.botUserId)) {
      return 'bot-not-ready';
    }

    let powerLevels: unknown;
    try {
      powerLevels = await this.matrixClient.getRoomStateEvent(
        roomId,
        'm.room.power_levels',
        '',
      );
    } catch (error) {
      if (!isTrustedMatrixMissingStateError(error)) {
        return 'bot-not-ready';
      }
      powerLevels = undefined;
    }

    const canSendMessages = canSendMatrixEvent(
      powerLevels,
      this.botUserId,
      'm.room.message',
      false,
    );
    const canWriteWidgets = canSendMatrixEvent(
      powerLevels,
      this.botUserId,
      'im.vector.modular.widgets',
      true,
    );
    if (!canSendMessages || !canWriteWidgets) {
      if (
        await isMatrixRoomV12Creator(
          this.matrixClient,
          this.botUserId,
          roomId,
        )
      ) {
        return undefined;
      }
      return canSendMessages ? 'widget-power-required' : 'bot-not-ready';
    }
    return undefined;
  }

  private isAllowedActorServer(actorUserId: string): boolean {
    const actor = parseRoomCalendarServiceUserId(actorUserId);
    if (!actor) return false;

    const configured = this.configuration.allowedActorServerNames;
    if (configured !== undefined && !Array.isArray(configured)) return false;
    if (
      configured?.some(
        (serverName) =>
          typeof serverName !== 'string' || !isMatrixServerName(serverName),
      )
    ) {
      return false;
    }
    const bot = parseRoomCalendarServiceUserId(this.botUserId);
    const allowlist =
      configured && configured.length > 0
        ? configured
        : bot
          ? [bot.serverName]
          : [];
    if (allowlist.length === 0) return false;

    const normalizedActorServer = actor.serverName.toLowerCase();
    return allowlist.some(
      (serverName) => serverName.toLowerCase() === normalizedActorServer,
    );
  }
}

function isExactReadyRecord(
  record: RoomCalendarBindingRecord,
  binding: RoomCalendarBinding,
): boolean {
  return (
    record.roomId === binding.roomId &&
    record.calendarId === binding.calendarId &&
    record.status === 'ready'
  );
}

function sameBinding(
  left: RoomCalendarBinding | undefined,
  right: RoomCalendarBinding,
): boolean {
  return (
    left?.roomId === right.roomId && left.calendarId === right.calendarId
  );
}

function isGeneratedCalendarId(value: string): boolean {
  return GENERATED_CALENDAR_ID.test(value);
}

function canSendMatrixEvent(
  value: unknown,
  userId: string,
  eventType: string,
  isState: boolean,
): boolean {
  if (value === undefined) {
    return isState ? 0 >= 50 : true;
  }
  if (!isRecord(value)) return false;

  const users = getOptionalRecord(value.users);
  if (value.users !== undefined && !users) return false;
  const explicitUserPower = users?.[userId];
  const userDefault = getLevel(value.users_default, 0);
  const userPower =
    explicitUserPower === undefined
      ? userDefault
      : getLevel(explicitUserPower, undefined);

  const events = getOptionalRecord(value.events);
  if (value.events !== undefined && !events) return false;
  const eventPower = events?.[eventType];
  const defaultValue = isState
    ? getLevel(value.state_default, 50)
    : getLevel(value.events_default, 0);
  const requiredPower =
    eventPower === undefined ? defaultValue : getLevel(eventPower, undefined);

  return (
    userPower !== undefined &&
    requiredPower !== undefined &&
    userPower >= requiredPower
  );
}

function getLevel(value: unknown, fallback: number | undefined): number | undefined {
  if (value === undefined) return fallback;
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function getOptionalRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
