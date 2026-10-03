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

import { createHash } from 'crypto';
import { performance } from 'perf_hooks';
import { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import { validateRoomCalendarBindings } from '../service/RoomCalendarBindingResolver';
import {
  buildRoomMentionMessage,
  RoomMentionMessage,
} from './RoomMentionMessage';
import {
  authorizeRoomMentionDelivery,
  RoomMentionMatrixState,
} from './RoomMentionPolicy';
import {
  createReminderDeliveryKey,
  ReminderConfigurationCursor,
  ReminderDeliveryClaim,
  ReminderFiringIdentity,
  RoomReminderConfiguration,
  RoomReminderStore,
  validateReminderDeliveryIdentity,
} from './RoomReminderStore';

export const ROOM_REMINDER_SCHEDULER_LIMITS = Object.freeze({
  maxBindingsPerRun: 32,
  maxConfigurationsPerRun: 100,
  maxConfigurationPageSize: 100,
  maxDueCandidatesPerRun: 100,
  maxDeliveryClaimsPerRun: 20,
  maxCandidateCursorEntries: 1_000,
  maxLatenessMs: 24 * 60 * 60 * 1_000,
  scanDeadlineMs: 30_000,
  operationTimeoutMs: 2_000,
  postClaimWorkDeadlineMs: 7_000,
  postClaimReleaseReserveMs: 3_000,
  deliveryLeaseMs: 30_000,
  maxMessageBytes: 4_096,
});

const MAX_CANDIDATE_PAGE_CALLS_PER_RUN =
  ROOM_REMINDER_SCHEDULER_LIMITS.maxConfigurationsPerRun +
  ROOM_REMINDER_SCHEDULER_LIMITS.maxDueCandidatesPerRun;
const MAX_POST_CLAIM_TOTAL_MS =
  ROOM_REMINDER_SCHEDULER_LIMITS.postClaimWorkDeadlineMs +
  ROOM_REMINDER_SCHEDULER_LIMITS.postClaimReleaseReserveMs;
const PRECLAIM_OPERATION_TIMEOUT_MS =
  ROOM_REMINDER_SCHEDULER_LIMITS.operationTimeoutMs;

export type ReminderSchedulerWindow = Readonly<{
  /** Oldest supported due instant; older firings are deliberately abandoned. */
  notBefore: Date;
  /** Fixed at the start of the scan so a run has a stable due window. */
  through: Date;
}>;

export type ReminderCandidateCursor = Readonly<{
  recurrenceId: string;
  triggerOrdinal: number;
}>;

export type ReminderDueCandidate = Readonly<{
  /** Identity of the actual occurrence, not the master sidecar configuration. */
  identity: ReminderFiringIdentity;
  dueAt: Date;
}>;

export type ResolvedReminderDelivery = Readonly<{
  /** Recomputed from the current canonical event/alarm after the claim. */
  dueAt: Date;
  /** Safe current event summary rendered by the canonical source adapter. */
  body: string;
}>;

export type ReminderSchedulerRuntimeConfiguration = Readonly<{
  roomCalendarBindings: unknown;
  applicationServiceSenderUserId?: string;
  roomCalendarAccessEnabled: boolean;
  roomReminderDeliveryEnabled: boolean;
  reminderStoreEnabled: boolean;
}>;

export interface ReminderSchedulerRuntimeSource {
  /** Implementations must observe abort and stop/settle outstanding work. */
  getCurrentConfiguration(
    signal: AbortSignal,
  ): Promise<ReminderSchedulerRuntimeConfiguration>;
}

/**
 * Canonical calendar adapter. Candidate pages are keyset ordered by
 * `(recurrenceId, triggerOrdinal)` within one persisted alarm configuration,
 * and must contain no more than `limit` due occurrences from `window`.
 * The core asks for one at a time to round-robin configs under a claim cap.
 */
export interface CanonicalReminderSchedulerSource {
  /**
   * Resolve only supported relative DISPLAY alarms from the current canonical
   * VEVENT/VALARM. The occurrence recurrenceId must preserve typed DTSTART /
   * RECURRENCE-ID semantics; floating or DATE values are not implicitly UTC.
   * Implementations must observe abort and stop/settle outstanding work.
   */
  listDueCandidates(
    configuration: RoomReminderConfiguration,
    window: ReminderSchedulerWindow,
    after: ReminderCandidateCursor | undefined,
    limit: 1,
    signal: AbortSignal,
  ): Promise<readonly ReminderDueCandidate[]>;

  /**
   * Re-read the canonical event and alarm for this exact firing identity.
   * Implementations must observe abort and stop/settle outstanding work.
   */
  resolveCurrentDelivery(
    configuration: RoomReminderConfiguration,
    identity: ReminderFiringIdentity,
    window: ReminderSchedulerWindow,
    signal: AbortSignal,
  ): Promise<ResolvedReminderDelivery | undefined>;
}

export interface RoomReminderSchedulerSender {
  /**
   * The transaction ID is stable for the persisted delivery key across retries.
   * Implementations must observe abort and stop/settle outstanding work. A
   * timeout does not prove the homeserver did not accept the transaction.
   */
  sendRoomMention(
    roomId: string,
    calendarId: string,
    message: RoomMentionMessage,
    transactionId: string,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface RoomReminderSchedulerDependencies {
  readonly store: RoomReminderStore;
  readonly runtime: ReminderSchedulerRuntimeSource;
  readonly canonical: CanonicalReminderSchedulerSource;
  readonly matrixState: RoomMentionMatrixState;
  readonly sender: RoomReminderSchedulerSender;
  /** Wall clock used only to build the stable due window. */
  readonly now?: () => Date;
}

export type RoomReminderSchedulerOptions = Readonly<{
  maxBindingsPerRun: number;
  maxConfigurationsPerRun: number;
  maxDueCandidatesPerRun: number;
  maxDeliveryClaimsPerRun: number;
  maxCandidateCursorEntries: number;
  maxLatenessMs: number;
}>;

export type RoomReminderSchedulerReport = {
  schedulerFailures: number;
  overlappingRunSkipped: number;
  storeDisabled: number;
  invalidRuntimeConfiguration: number;
  bindingLimitExceeded: number;
  bindingsVisited: number;
  configurationsVisited: number;
  candidatePagesRead: number;
  candidatesInspected: number;
  deliveryClaimAttempts: number;
  deliveryClaimsAcquired: number;
  deliveriesSent: number;
  deliveriesDenied: number;
  deliveriesStale: number;
  deliveryClaimsReleased: number;
  candidateSourceFailures: number;
  storeFailures: number;
  deliveryFailures: number;
  releaseFailures: number;
  configurationPageOverflow: number;
  candidatePageOverflow: number;
  scanDeadlineReached: number;
};

type CandidateConfigurationState = {
  configuration: RoomReminderConfiguration;
  key: string;
  after: ReminderCandidateCursor | undefined;
  exhausted: boolean;
};

type CandidateCursorEntry = {
  cursor: ReminderCandidateCursor;
  bindingKey: string;
};

class ReminderOperationTimeout extends Error {}
class ReminderScanDeadline extends Error {}

/**
 * Bounded, intentionally unbootstrapped scheduler core. Runtime adapters are
 * supplied by a later integration slice; this class does not start a timer or
 * send anything merely by being imported.
 */
export class RoomReminderScheduler {
  private readonly now: () => Date;
  private readonly options: RoomReminderSchedulerOptions;
  private readonly configurationCursors = new Map<
    string,
    ReminderConfigurationCursor
  >();
  private readonly candidateCursors = new Map<string, CandidateCursorEntry>();
  private lastBinding: RoomCalendarBinding | undefined;
  private lastCandidateConfiguration: RoomReminderConfiguration | undefined;
  private running = false;

  constructor(
    private readonly dependencies: RoomReminderSchedulerDependencies,
    options: Partial<RoomReminderSchedulerOptions> = {},
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.options = validateOptions(options);
  }

  async runOnce(signal?: AbortSignal): Promise<RoomReminderSchedulerReport> {
    const report = createEmptyReport();
    if (signal?.aborted) return report;
    if (this.running) {
      report.overlappingRunSkipped = 1;
      return report;
    }

    this.running = true;
    try {
      await this.scan(report, signal);
    } catch {
      if (!signal?.aborted) report.schedulerFailures += 1;
    } finally {
      this.running = false;
    }
    return report;
  }

  private async scan(
    report: RoomReminderSchedulerReport,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.dependencies.store.enabled) {
      report.storeDisabled = 1;
      return;
    }

    const scanDeadline =
      performance.now() + ROOM_REMINDER_SCHEDULER_LIMITS.scanDeadlineMs;
    let initialRuntime: ReminderSchedulerRuntimeConfiguration;
    try {
      initialRuntime = await this.runPreClaimOperation(
        scanDeadline,
        (signal) => this.dependencies.runtime.getCurrentConfiguration(signal),
        signal,
      );
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof ReminderScanDeadline) {
        report.scanDeadlineReached = 1;
      } else {
        report.invalidRuntimeConfiguration = 1;
      }
      return;
    }

    if (
      initialRuntime.roomReminderDeliveryEnabled !== true ||
      initialRuntime.roomCalendarAccessEnabled !== true ||
      initialRuntime.reminderStoreEnabled !== true
    ) {
      report.deliveriesDenied += 1;
      return;
    }

    let bindings: readonly RoomCalendarBinding[];
    try {
      if (
        !Array.isArray(initialRuntime.roomCalendarBindings) ||
        initialRuntime.roomCalendarBindings.length >
          this.options.maxBindingsPerRun
      ) {
        if (
          Array.isArray(initialRuntime.roomCalendarBindings) &&
          initialRuntime.roomCalendarBindings.length >
            this.options.maxBindingsPerRun
        ) {
          report.bindingLimitExceeded = 1;
        } else {
          report.invalidRuntimeConfiguration = 1;
        }
        return;
      }
      bindings = [
        ...validateRoomCalendarBindings(initialRuntime.roomCalendarBindings),
      ].sort(compareBindings);
    } catch {
      report.invalidRuntimeConfiguration = 1;
      return;
    }

    this.pruneBindingCursors(bindings);
    this.pruneCandidateCursorsForBindings(bindings);
    if (bindings.length === 0) return;

    const window = this.createWindow();
    if (!window) {
      report.invalidRuntimeConfiguration = 1;
      return;
    }

    const orderedBindings = rotateAfter(
      bindings,
      this.lastBinding,
      compareBindings,
    );
    const perBindingPageLimit = Math.min(
      ROOM_REMINDER_SCHEDULER_LIMITS.maxConfigurationPageSize,
      Math.max(
        1,
        Math.floor(
          this.options.maxConfigurationsPerRun / orderedBindings.length,
        ),
      ),
    );
    const configurations: RoomReminderConfiguration[] = [];

    for (const binding of orderedBindings) {
      if (signal?.aborted) return;
      if (configurations.length >= this.options.maxConfigurationsPerRun) break;
      if (this.preClaimBudgetEnded(scanDeadline)) {
        report.scanDeadlineReached = 1;
        break;
      }

      this.lastBinding = binding;
      const bindingKey = getBindingKey(binding);
      const after = this.configurationCursors.get(bindingKey);
      report.bindingsVisited += 1;

      const senderUserId = initialRuntime.applicationServiceSenderUserId;
      if (
        typeof senderUserId !== 'string' ||
        senderUserId.trim().length === 0
      ) {
        report.deliveriesDenied += 1;
        continue;
      }
      try {
        const bindingAuthorized = await this.runPreClaimOperation(
          scanDeadline,
          async (signal) =>
            (await authorizeRoomMentionDelivery(
              {
                roomId: binding.roomId,
                calendarId: binding.calendarId,
                applicationServiceSenderUserId: senderUserId,
                configuredBindings: initialRuntime.roomCalendarBindings,
              },
              this.dependencies.matrixState,
              signal,
            )) !== undefined,
          signal,
        );
        if (!bindingAuthorized) {
          report.deliveriesDenied += 1;
          continue;
        }
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof ReminderScanDeadline) {
          report.scanDeadlineReached = 1;
          break;
        }
        report.deliveriesDenied += 1;
        continue;
      }

      try {
        const page = await this.runPreClaimOperation(
          scanDeadline,
          (signal) =>
            this.dependencies.store.listConfigurationPage(
              binding.roomId,
              binding.calendarId,
              after,
              Math.min(
                perBindingPageLimit,
                this.options.maxConfigurationsPerRun - configurations.length,
              ),
              signal,
            ),
          signal,
        );
        const pageLimit = Math.min(
          perBindingPageLimit,
          this.options.maxConfigurationsPerRun - configurations.length,
        );
        if (page.length > pageLimit) {
          report.configurationPageOverflow += 1;
        }
        const boundedPage = page.slice(0, pageLimit);
        for (const configuration of boundedPage) {
          if (
            configuration.roomId !== binding.roomId ||
            configuration.calendarId !== binding.calendarId
          ) {
            report.configurationPageOverflow += 1;
            continue;
          }
          configurations.push(configuration);
        }

        if (boundedPage.length === 0 || boundedPage.length < pageLimit) {
          this.configurationCursors.delete(bindingKey);
        } else {
          const last = boundedPage[boundedPage.length - 1];
          this.configurationCursors.set(bindingKey, {
            eventUid: last.eventUid,
            recurrenceId: last.recurrenceId,
            alarmUid: last.alarmUid,
          });
        }
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof ReminderScanDeadline) {
          report.scanDeadlineReached = 1;
          break;
        }
        report.storeFailures += 1;
      }
    }

    report.configurationsVisited = configurations.length;
    if (configurations.length === 0) return;

    this.pruneCandidateCursorsToCapacity();
    const candidateStates = configurations
      .map((configuration) => ({
        configuration,
        key: getConfigurationKey(configuration),
        after: this.getCandidateCursor(configuration),
        exhausted: false,
      }))
      .sort((left, right) =>
        compareConfigurations(left.configuration, right.configuration),
      );
    const orderedCandidateStates = rotateCandidateStates(
      candidateStates,
      this.lastCandidateConfiguration,
    );

    let candidatePageCalls = 0;
    while (
      report.candidatesInspected < this.options.maxDueCandidatesPerRun &&
      report.deliveryClaimAttempts < this.options.maxDeliveryClaimsPerRun &&
      candidatePageCalls < MAX_CANDIDATE_PAGE_CALLS_PER_RUN
    ) {
      if (signal?.aborted) return;
      let didWork = false;
      for (const state of orderedCandidateStates) {
        if (signal?.aborted) return;
        if (
          report.candidatesInspected >= this.options.maxDueCandidatesPerRun ||
          report.deliveryClaimAttempts >=
            this.options.maxDeliveryClaimsPerRun ||
          candidatePageCalls >= MAX_CANDIDATE_PAGE_CALLS_PER_RUN
        ) {
          break;
        }
        if (state.exhausted) continue;
        if (
          this.preClaimBudgetEnded(
            scanDeadline,
            MAX_POST_CLAIM_TOTAL_MS + PRECLAIM_OPERATION_TIMEOUT_MS,
          )
        ) {
          report.scanDeadlineReached = 1;
          break;
        }

        candidatePageCalls += 1;
        report.candidatePagesRead += 1;
        let page: readonly ReminderDueCandidate[];
        try {
          page = await this.runPreClaimOperation(
            scanDeadline,
            (signal) =>
              this.dependencies.canonical.listDueCandidates(
                state.configuration,
                window,
                state.after,
                1,
                signal,
              ),
            signal,
          );
        } catch (error) {
          if (signal?.aborted) return;
          state.exhausted = true;
          if (error instanceof ReminderScanDeadline) {
            report.scanDeadlineReached = 1;
            break;
          }
          report.candidateSourceFailures += 1;
          continue;
        }

        if (page.length === 0) {
          state.exhausted = true;
          this.candidateCursors.delete(state.key);
          continue;
        }
        if (page.length !== 1) {
          state.exhausted = true;
          report.candidatePageOverflow += 1;
          continue;
        }

        const candidate = page[0];
        report.candidatesInspected += 1;
        didWork = true;
        this.lastCandidateConfiguration = state.configuration;
        if (!isCandidateForConfiguration(candidate, state.configuration)) {
          state.exhausted = true;
          report.candidateSourceFailures += 1;
          continue;
        }

        state.after = {
          recurrenceId: candidate.identity.recurrenceId,
          triggerOrdinal: candidate.identity.triggerOrdinal,
        };
        this.setCandidateCursor(state.configuration, state.after);
        if (!isDueAt(candidate.dueAt, window)) continue;

        report.deliveryClaimAttempts += 1;
        let claim: ReminderDeliveryClaim | undefined;
        try {
          claim = await this.runPreClaimOperation(
            scanDeadline,
            (signal) =>
              this.dependencies.store.claimDelivery(
                candidate.identity,
                ROOM_REMINDER_SCHEDULER_LIMITS.deliveryLeaseMs,
                signal,
              ),
            signal,
          );
        } catch (error) {
          if (signal?.aborted) return;
          if (error instanceof ReminderScanDeadline) {
            report.scanDeadlineReached = 1;
            break;
          }
          report.storeFailures += 1;
          continue;
        }

        if (!claim) continue;
        report.deliveryClaimsAcquired += 1;
        await this.deliverClaim(
          claim,
          candidate,
          state.configuration,
          window,
          scanDeadline,
          report,
          signal,
        );
      }

      if (report.scanDeadlineReached > 0) break;
      if (!didWork) break;
    }

    this.pruneCandidateCursorsToCapacity();
  }

  private async deliverClaim(
    claim: ReminderDeliveryClaim,
    candidate: ReminderDueCandidate,
    configuration: RoomReminderConfiguration,
    window: ReminderSchedulerWindow,
    scanDeadline: number,
    report: RoomReminderSchedulerReport,
    signal?: AbortSignal,
  ): Promise<void> {
    const startedAt = performance.now();
    const workDeadline =
      startedAt + ROOM_REMINDER_SCHEDULER_LIMITS.postClaimWorkDeadlineMs;
    const totalDeadline = Math.min(
      startedAt + MAX_POST_CLAIM_TOTAL_MS,
      scanDeadline,
    );
    let shouldRelease = true;

    try {
      const currentRuntime = await this.runPostClaimOperation(
        workDeadline,
        (signal) => this.dependencies.runtime.getCurrentConfiguration(signal),
        signal,
      );
      if (
        currentRuntime.roomReminderDeliveryEnabled !== true ||
        currentRuntime.roomCalendarAccessEnabled !== true ||
        currentRuntime.reminderStoreEnabled !== true
      ) {
        report.deliveriesDenied += 1;
        return;
      }
      const binding = findCurrentBinding(
        currentRuntime,
        configuration.roomId,
        configuration.calendarId,
      );
      if (!binding) {
        report.deliveriesStale += 1;
        return;
      }

      const stillConfigured = await this.runPostClaimOperation(
        workDeadline,
        (signal) =>
          this.dependencies.store.hasConfiguration(configuration, signal),
        signal,
      );
      if (!stillConfigured) {
        this.candidateCursors.delete(getConfigurationKey(configuration));
        report.deliveriesStale += 1;
        return;
      }

      const senderUserId = currentRuntime.applicationServiceSenderUserId;
      if (
        typeof senderUserId !== 'string' ||
        senderUserId.trim().length === 0
      ) {
        report.deliveriesDenied += 1;
        return;
      }
      const allowed = await this.runPostClaimOperation(
        workDeadline,
        async (signal) =>
          (await authorizeRoomMentionDelivery(
            {
              roomId: configuration.roomId,
              calendarId: configuration.calendarId,
              applicationServiceSenderUserId: senderUserId,
              configuredBindings: currentRuntime.roomCalendarBindings,
            },
            this.dependencies.matrixState,
            signal,
          )) !== undefined,
        signal,
      );
      if (!allowed) {
        report.deliveriesDenied += 1;
        return;
      }

      // Room encryption and current sender permissions are checked before
      // reading canonical event content. The sender adapter rechecks state
      // immediately before its stable-transaction PUT.
      const current = await this.runPostClaimOperation(
        workDeadline,
        (signal) =>
          this.dependencies.canonical.resolveCurrentDelivery(
            configuration,
            candidate.identity,
            window,
            signal,
          ),
        signal,
      );
      if (
        !current ||
        !isDueAt(current.dueAt, window) ||
        typeof current.body !== 'string' ||
        current.body.trim().length === 0 ||
        Buffer.byteLength(current.body, 'utf8') >
          ROOM_REMINDER_SCHEDULER_LIMITS.maxMessageBytes
      ) {
        report.deliveriesStale += 1;
        return;
      }

      const expectedDeliveryKey = createReminderDeliveryKey(candidate.identity);
      if (
        claim.deliveryKey !== expectedDeliveryKey ||
        !/^[a-f0-9]{64}$/.test(claim.deliveryKey)
      ) {
        report.deliveryFailures += 1;
        return;
      }
      const message = buildRoomMentionMessage(current.body);
      await this.runPostClaimOperation(
        workDeadline,
        (signal) =>
          this.dependencies.sender.sendRoomMention(
            configuration.roomId,
            configuration.calendarId,
            message,
            `mcal-reminder-${claim.deliveryKey}`,
            signal,
          ),
        signal,
      );

      const markedSent = await this.runPostClaimOperation(
        workDeadline,
        (signal) =>
          this.dependencies.store.markDeliverySent(
            claim.deliveryKey,
            claim.claimToken,
            signal,
          ),
        signal,
      );
      if (markedSent) {
        shouldRelease = false;
        report.deliveriesSent += 1;
      } else {
        shouldRelease = false;
        report.deliveryFailures += 1;
      }
    } catch {
      if (!signal?.aborted) report.deliveryFailures += 1;
    } finally {
      if (shouldRelease) {
        try {
          const released = await this.runReleaseOperation(
            totalDeadline,
            (signal) =>
              this.dependencies.store.releaseDeliveryClaim(
                claim.deliveryKey,
                claim.claimToken,
                signal,
              ),
          );
          if (released) report.deliveryClaimsReleased += 1;
        } catch {
          report.releaseFailures += 1;
        }
      }
    }
  }

  private createWindow(): ReminderSchedulerWindow | undefined {
    const through = this.now();
    if (!(through instanceof Date) || !Number.isFinite(through.getTime())) {
      return undefined;
    }
    return {
      notBefore: new Date(through.getTime() - this.options.maxLatenessMs),
      through,
    };
  }

  private async runPreClaimOperation<T>(
    scanDeadline: number,
    operation: (signal: AbortSignal) => Promise<T>,
    parentSignal?: AbortSignal,
  ): Promise<T> {
    return runWithDeadline(
      scanDeadline,
      ROOM_REMINDER_SCHEDULER_LIMITS.operationTimeoutMs,
      operation,
      parentSignal,
    );
  }

  private async runPostClaimOperation<T>(
    workDeadline: number,
    operation: (signal: AbortSignal) => Promise<T>,
    parentSignal?: AbortSignal,
  ): Promise<T> {
    return runWithDeadline(
      workDeadline,
      ROOM_REMINDER_SCHEDULER_LIMITS.operationTimeoutMs,
      operation,
      parentSignal,
    );
  }

  private async runReleaseOperation<T>(
    totalDeadline: number,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return runWithDeadline(
      totalDeadline,
      ROOM_REMINDER_SCHEDULER_LIMITS.postClaimReleaseReserveMs,
      operation,
    );
  }

  private preClaimBudgetEnded(scanDeadline: number, reserveMs = 0): boolean {
    return performance.now() + reserveMs >= scanDeadline;
  }

  private pruneBindingCursors(bindings: readonly RoomCalendarBinding[]): void {
    const activeKeys = new Set(bindings.map(getBindingKey));
    for (const key of this.configurationCursors.keys()) {
      if (!activeKeys.has(key)) this.configurationCursors.delete(key);
    }
    if (
      this.lastBinding &&
      !bindings.some((binding) => sameBinding(binding, this.lastBinding!))
    ) {
      this.lastBinding = undefined;
    }
    if (
      this.lastCandidateConfiguration &&
      !bindings.some(
        (binding) =>
          binding.roomId === this.lastCandidateConfiguration!.roomId &&
          binding.calendarId === this.lastCandidateConfiguration!.calendarId,
      )
    ) {
      this.lastCandidateConfiguration = undefined;
    }
  }

  private getCandidateCursor(
    configuration: RoomReminderConfiguration,
  ): ReminderCandidateCursor | undefined {
    const key = getConfigurationKey(configuration);
    const entry = this.candidateCursors.get(key);
    if (entry) {
      this.candidateCursors.delete(key);
      this.candidateCursors.set(key, entry);
    }
    return entry?.cursor;
  }

  private setCandidateCursor(
    configuration: RoomReminderConfiguration,
    cursor: ReminderCandidateCursor,
  ): void {
    const key = getConfigurationKey(configuration);
    this.candidateCursors.delete(key);
    this.candidateCursors.set(key, {
      cursor,
      bindingKey: getBindingKey(configuration),
    });
    this.pruneCandidateCursorsToCapacity();
  }

  private pruneCandidateCursorsForBindings(
    bindings: readonly RoomCalendarBinding[],
  ): void {
    const activeKeys = new Set(bindings.map(getBindingKey));
    for (const [key, entry] of this.candidateCursors) {
      if (!activeKeys.has(entry.bindingKey)) this.candidateCursors.delete(key);
    }
  }

  private pruneCandidateCursorsToCapacity(): void {
    while (
      this.candidateCursors.size > this.options.maxCandidateCursorEntries
    ) {
      const oldestKey = this.candidateCursors.keys().next().value;
      if (oldestKey === undefined) return;
      this.candidateCursors.delete(oldestKey);
    }
  }
}

function validateOptions(
  options: Partial<RoomReminderSchedulerOptions>,
): RoomReminderSchedulerOptions {
  const result: RoomReminderSchedulerOptions = {
    maxBindingsPerRun:
      options.maxBindingsPerRun ??
      ROOM_REMINDER_SCHEDULER_LIMITS.maxBindingsPerRun,
    maxConfigurationsPerRun:
      options.maxConfigurationsPerRun ??
      ROOM_REMINDER_SCHEDULER_LIMITS.maxConfigurationsPerRun,
    maxDueCandidatesPerRun:
      options.maxDueCandidatesPerRun ??
      ROOM_REMINDER_SCHEDULER_LIMITS.maxDueCandidatesPerRun,
    maxDeliveryClaimsPerRun:
      options.maxDeliveryClaimsPerRun ??
      ROOM_REMINDER_SCHEDULER_LIMITS.maxDeliveryClaimsPerRun,
    maxCandidateCursorEntries:
      options.maxCandidateCursorEntries ??
      ROOM_REMINDER_SCHEDULER_LIMITS.maxCandidateCursorEntries,
    maxLatenessMs:
      options.maxLatenessMs ?? ROOM_REMINDER_SCHEDULER_LIMITS.maxLatenessMs,
  };
  const maximums = ROOM_REMINDER_SCHEDULER_LIMITS;
  const bounds: [keyof RoomReminderSchedulerOptions, number][] = [
    ['maxBindingsPerRun', maximums.maxBindingsPerRun],
    ['maxConfigurationsPerRun', maximums.maxConfigurationsPerRun],
    ['maxDueCandidatesPerRun', maximums.maxDueCandidatesPerRun],
    ['maxDeliveryClaimsPerRun', maximums.maxDeliveryClaimsPerRun],
    ['maxCandidateCursorEntries', maximums.maxCandidateCursorEntries],
    ['maxLatenessMs', maximums.maxLatenessMs],
  ];
  for (const [name, maximum] of bounds) {
    const value = result[name];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`Invalid room reminder scheduler option: ${name}`);
    }
  }
  return Object.freeze(result);
}

function createEmptyReport(): RoomReminderSchedulerReport {
  return {
    schedulerFailures: 0,
    overlappingRunSkipped: 0,
    storeDisabled: 0,
    invalidRuntimeConfiguration: 0,
    bindingLimitExceeded: 0,
    bindingsVisited: 0,
    configurationsVisited: 0,
    candidatePagesRead: 0,
    candidatesInspected: 0,
    deliveryClaimAttempts: 0,
    deliveryClaimsAcquired: 0,
    deliveriesSent: 0,
    deliveriesDenied: 0,
    deliveriesStale: 0,
    deliveryClaimsReleased: 0,
    candidateSourceFailures: 0,
    storeFailures: 0,
    deliveryFailures: 0,
    releaseFailures: 0,
    configurationPageOverflow: 0,
    candidatePageOverflow: 0,
    scanDeadlineReached: 0,
  };
}

function findCurrentBinding(
  runtime: ReminderSchedulerRuntimeConfiguration,
  roomId: string,
  calendarId: string,
): RoomCalendarBinding | undefined {
  try {
    if (
      !Array.isArray(runtime.roomCalendarBindings) ||
      runtime.roomCalendarBindings.length >
        ROOM_REMINDER_SCHEDULER_LIMITS.maxBindingsPerRun
    ) {
      return undefined;
    }
    return validateRoomCalendarBindings(runtime.roomCalendarBindings).find(
      (binding) =>
        binding.roomId === roomId && binding.calendarId === calendarId,
    );
  } catch {
    return undefined;
  }
}

function isCandidateForConfiguration(
  candidate: ReminderDueCandidate,
  configuration: RoomReminderConfiguration,
): boolean {
  try {
    const identity = candidate.identity;
    if (
      identity.recurrenceId === null ||
      identity.roomId !== configuration.roomId ||
      identity.calendarId !== configuration.calendarId ||
      identity.eventUid !== configuration.eventUid ||
      identity.alarmUid !== configuration.alarmUid
    ) {
      return false;
    }
    validateReminderDeliveryIdentity(identity);
    return true;
  } catch {
    return false;
  }
}

function isDueAt(dueAt: Date, window: ReminderSchedulerWindow): boolean {
  return (
    dueAt instanceof Date &&
    Number.isFinite(dueAt.getTime()) &&
    dueAt.getTime() >= window.notBefore.getTime() &&
    dueAt.getTime() <= window.through.getTime()
  );
}

function getBindingKey(binding: RoomCalendarBinding): string {
  return createHash('sha256')
    .update(JSON.stringify([binding.roomId, binding.calendarId]))
    .digest('hex');
}

function getConfigurationKey(configuration: RoomReminderConfiguration): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        configuration.roomId,
        configuration.calendarId,
        configuration.eventUid,
        configuration.recurrenceId,
        configuration.alarmUid,
      ]),
    )
    .digest('hex');
}

function compareBindings(
  left: RoomCalendarBinding,
  right: RoomCalendarBinding,
): number {
  return (
    compareText(left.roomId, right.roomId) ||
    compareText(left.calendarId, right.calendarId)
  );
}

function compareConfigurations(
  left: RoomReminderConfiguration,
  right: RoomReminderConfiguration,
): number {
  return (
    compareBindings(left, right) ||
    compareText(left.eventUid, right.eventUid) ||
    compareText(left.recurrenceId ?? '', right.recurrenceId ?? '') ||
    compareText(left.alarmUid, right.alarmUid)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rotateAfter<T>(
  values: readonly T[],
  cursor: T | undefined,
  compare: (left: T, right: T) => number,
): T[] {
  if (!cursor || values.length < 2) return [...values];
  const nextIndex = values.findIndex((value) => compare(value, cursor) > 0);
  return nextIndex <= 0
    ? [...values]
    : [...values.slice(nextIndex), ...values.slice(0, nextIndex)];
}

function rotateCandidateStates(
  states: readonly CandidateConfigurationState[],
  cursor: RoomReminderConfiguration | undefined,
): CandidateConfigurationState[] {
  if (!cursor || states.length < 2) return [...states];
  const nextIndex = states.findIndex(
    (state) => compareConfigurations(state.configuration, cursor) > 0,
  );
  return nextIndex <= 0
    ? [...states]
    : [...states.slice(nextIndex), ...states.slice(0, nextIndex)];
}

function sameBinding(
  left: RoomCalendarBinding,
  right: RoomCalendarBinding,
): boolean {
  return left.roomId === right.roomId && left.calendarId === right.calendarId;
}

async function runWithDeadline<T>(
  deadline: number,
  operationMaximumMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (parentSignal?.aborted) throw abortError();
  const remaining = deadline - performance.now();
  if (remaining <= 0) throw new ReminderScanDeadline();

  const timeoutMs = Math.min(remaining, operationMaximumMs);
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  let parentAbortListener: (() => void) | undefined;
  const work = Promise.resolve().then(() => operation(controller.signal));
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(
        timeoutMs < remaining
          ? new ReminderOperationTimeout()
          : new ReminderScanDeadline(),
      );
    }, timeoutMs);
  });
  const cancelled = parentSignal
    ? new Promise<never>((_resolve, reject) => {
        parentAbortListener = () => {
          controller.abort();
          reject(abortError());
        };
        parentSignal.addEventListener('abort', parentAbortListener, {
          once: true,
        });
        if (parentSignal.aborted) parentAbortListener();
      })
    : undefined;

  try {
    return await Promise.race(
      cancelled ? [work, timeout, cancelled] : [work, timeout],
    );
  } catch (error) {
    if (timedOut) {
      throw timeoutMs < remaining
        ? new ReminderOperationTimeout()
        : new ReminderScanDeadline();
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (parentSignal && parentAbortListener) {
      parentSignal.removeEventListener('abort', parentAbortListener);
    }
  }
}

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError');
}
