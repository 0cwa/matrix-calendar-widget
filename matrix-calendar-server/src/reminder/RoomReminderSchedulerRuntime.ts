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

import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { IAppConfiguration } from '../IAppConfiguration';
import { validateRoomCalendarBindings } from '../service/RoomCalendarBindingResolver';
import {
  ReminderSchedulerRuntimeConfiguration,
  ReminderSchedulerRuntimeSource,
  ROOM_REMINDER_SCHEDULER_LIMITS,
  RoomReminderScheduler,
} from './RoomReminderScheduler';
import { RoomReminderStore } from './RoomReminderStore';

export const ROOM_REMINDER_SCHEDULER_INTERVAL_MS = 60_000;

/** Safe current operator configuration for scheduler scans and send checks. */
export class ConfiguredReminderSchedulerRuntimeSource implements ReminderSchedulerRuntimeSource {
  constructor(
    private readonly appConfig: IAppConfiguration,
    private readonly store: RoomReminderStore,
  ) {}

  async getCurrentConfiguration(
    signal: AbortSignal,
  ): Promise<ReminderSchedulerRuntimeConfiguration> {
    throwIfAborted(signal);
    const roomCalendarAccessEnabled =
      this.appConfig.room_calendar_access_enabled === true;
    const roomReminderDeliveryEnabled =
      this.appConfig.room_reminder_delivery_enabled === true;
    const reminderStoreEnabled = this.store.enabled === true;
    const configured =
      roomCalendarAccessEnabled &&
      roomReminderDeliveryEnabled &&
      reminderStoreEnabled &&
      hasNonEmptyString(this.appConfig.application_service_token) &&
      hasNonEmptyString(this.appConfig.application_service_user_id) &&
      hasNonEmptyString(this.appConfig.homeserver_url) &&
      hasNonEmptyString(this.appConfig.radicale_url);

    let bindings: unknown = [];
    let senderUserId: string | undefined;
    if (configured) {
      try {
        const validated = validateRoomCalendarBindings(
          this.appConfig.room_calendar_bindings,
        );
        if (
          validated.length > 0 &&
          validated.length <= ROOM_REMINDER_SCHEDULER_LIMITS.maxBindingsPerRun
        ) {
          bindings = validated;
          senderUserId = this.appConfig.application_service_user_id;
        }
      } catch {
        // Invalid operator bindings disable delivery for this process.
      }
    }

    return {
      roomCalendarBindings: bindings,
      applicationServiceSenderUserId: senderUserId,
      roomCalendarAccessEnabled,
      roomReminderDeliveryEnabled,
      reminderStoreEnabled,
    };
  }
}

/**
 * Non-overlapping, awaitably stoppable scheduler lifecycle. It is inert unless
 * all explicit delivery/read/storage gates and server-side credentials exist.
 */
export class RoomReminderSchedulerLifecycle
  implements OnModuleInit, OnModuleDestroy
{
  private started = false;
  private stopped = false;
  private running = false;
  private timer?: NodeJS.Timeout;
  private activeController?: AbortController;
  private activeRun?: Promise<void>;

  constructor(
    private readonly appConfig: IAppConfiguration,
    private readonly store: RoomReminderStore,
    private readonly scheduler: Pick<RoomReminderScheduler, 'runOnce'>,
    private readonly intervalMs = ROOM_REMINDER_SCHEDULER_INTERVAL_MS,
  ) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): Promise<void> {
    return this.stop();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    if (!this.isReady()) return;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.activeController?.abort();
    await this.activeRun;
  }

  private isReady(): boolean {
    if (
      this.appConfig.room_reminder_delivery_enabled !== true ||
      this.appConfig.room_calendar_access_enabled !== true ||
      !this.store.enabled ||
      !hasNonEmptyString(this.appConfig.application_service_token) ||
      !hasNonEmptyString(this.appConfig.application_service_user_id) ||
      !hasNonEmptyString(this.appConfig.homeserver_url) ||
      !hasNonEmptyString(this.appConfig.radicale_url) ||
      !Number.isSafeInteger(this.intervalMs) ||
      this.intervalMs < 1_000 ||
      this.intervalMs > ROOM_REMINDER_SCHEDULER_INTERVAL_MS
    ) {
      return false;
    }

    try {
      const homeserver = new URL(this.appConfig.homeserver_url);
      const radicale = new URL(this.appConfig.radicale_url);
      if (
        !['http:', 'https:'].includes(homeserver.protocol) ||
        !['http:', 'https:'].includes(radicale.protocol) ||
        homeserver.username ||
        homeserver.password ||
        homeserver.search ||
        homeserver.hash ||
        radicale.username ||
        radicale.password ||
        radicale.search ||
        radicale.hash
      ) {
        return false;
      }
      const bindings = validateRoomCalendarBindings(
        this.appConfig.room_calendar_bindings,
      );
      return (
        bindings.length > 0 &&
        bindings.length <= ROOM_REMINDER_SCHEDULER_LIMITS.maxBindingsPerRun &&
        typeof this.appConfig.application_service_user_id === 'string'
      );
    } catch {
      return false;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), delayMs);
  }

  private async run(): Promise<void> {
    if (this.stopped || this.running) return;
    this.timer = undefined;
    this.running = true;
    const controller = new AbortController();
    this.activeController = controller;
    const currentRun = this.scheduler
      .runOnce(controller.signal)
      .then(() => undefined)
      .catch(() => undefined);
    this.activeRun = currentRun;

    try {
      await currentRun;
    } finally {
      if (this.activeRun === currentRun) this.activeRun = undefined;
      if (this.activeController === controller)
        this.activeController = undefined;
      this.running = false;
      if (!this.stopped) this.schedule(this.intervalMs);
    }
  }
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new DOMException('The operation was aborted', 'AbortError');
}
