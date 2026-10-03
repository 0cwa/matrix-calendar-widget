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
  CalendarEvent,
  CalendarEventDateTime,
  CalendarEventTiming,
  CalendarTimeRange,
  parseSupportedCalendarEventRecurrenceRule,
  projectCalendarEventOccurrences,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import { IAppConfiguration } from '../IAppConfiguration';
import { CalDavEventClient } from '../caldav/CalDavEventClient';
import { DEFAULT_CALDAV_EVENT_RESPONSE_MAX_BYTES } from '../caldav/CalDavTransportLimits';
import { ICalendarEventCodec } from '../caldav/ICalendarEventCodec';
import { MatrixOpenIdCalDavCredentialProviderFactory } from '../caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import {
  RoomCalendarCalDavAccess,
  RoomCalendarTarget,
} from '../service/RoomCalendarCalDavAccess';
import {
  CanonicalReminderResolutionError,
  CanonicalReminderResourceData,
  CanonicalReminderResourceSelection,
  encodeCanonicalReminderFiringRecurrenceIdentity,
  resolveCanonicalReminderResourceSelection,
} from './CanonicalReminderIdentityResolver';
import {
  resolveProjectedReminderOccurrenceTiming,
  resolveTriggerableReminderIdentity,
} from './ReminderConfigurationSourceValidator';
import {
  MAX_REMINDER_EVENT_DURATION_MS,
  MAX_REMINDER_REPEAT_COUNT,
  MAX_REMINDER_TRIGGER_HORIZON_MS,
  calculateDisplayReminderDueAt,
  isReminderScheduleWithinLimits,
} from './ReminderTrigger';
import {
  CanonicalReminderSchedulerSource,
  ReminderCandidateCursor,
  ReminderDueCandidate,
  ReminderSchedulerWindow,
  ResolvedReminderDelivery,
} from './RoomReminderScheduler';
import { RoomReminderConfiguration } from './RoomReminderStore';

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_TIMEZONE_MARGIN_MS = 32 * 60 * 60 * 1_000;
const MAX_PROJECTION_CHUNK_MS = 120 * DAY_MS;
const MAX_PROJECTION_CHUNKS_PER_RUN = 1_200;
const MAX_PROJECTION_CHUNKS_PER_SCAN = 10;
const MAX_CANDIDATES_PER_CONFIGURATION = 512;
const MAX_CONFIGURATIONS_PER_WINDOW = 100;
const MAX_EVENT_UID_REPORT_RESOURCES = 2;
const MAX_REMINDER_BODY_BYTES = 4_000;

const NO_MATCH_CODES = new Set([
  'event-not-found',
  'recurrence-not-found',
  'alarm-not-found',
]);

export type CanonicalReminderSourceErrorCode =
  | 'unavailable'
  | 'ambiguous-resource'
  | 'unsupported-source'
  | 'scan-limit';

/** Fixed safe failure; never includes the CalDAV URL, ICS, or event text. */
export class CanonicalReminderSourceError extends Error {
  constructor(readonly code: CanonicalReminderSourceErrorCode) {
    super(`Canonical reminder source failed (${code})`);
    this.name = 'CanonicalReminderSourceError';
  }
}

export type CanonicalReminderSchedulerSourceOptions = Readonly<{
  fetchImpl?: typeof fetch;
  yieldToEventLoop?: (signal: AbortSignal) => Promise<void>;
}>;

type MaterializedReminderCandidate = {
  candidate: ReminderDueCandidate;
  body: string;
};

type WindowCache = {
  key: string;
  chunksUsed: number;
  configurations: Map<string, readonly MaterializedReminderCandidate[]>;
};

type SelectedResource = {
  resource: CanonicalReminderResourceData & {
    href: string;
    etag: string;
  };
  selection: CanonicalReminderResourceSelection;
  event: CalendarEvent;
};

/**
 * Resolves due DISPLAY alarms from one exact UID in one configured collection.
 * No href or event source is persisted or returned outside this service.
 */
export class CanonicalRoomReminderSchedulerSource implements CanonicalReminderSchedulerSource {
  private readonly fetchImpl: typeof fetch;
  private readonly yieldToEventLoop: (signal: AbortSignal) => Promise<void>;
  private windowCache?: WindowCache;

  constructor(
    private readonly appConfig: IAppConfiguration,
    private readonly roomCalendarAccess: RoomCalendarCalDavAccess,
    private readonly credentialProviderFactory: MatrixOpenIdCalDavCredentialProviderFactory,
    options: CanonicalReminderSchedulerSourceOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.yieldToEventLoop = options.yieldToEventLoop ?? yieldToEventLoop;
  }

  async listDueCandidates(
    configuration: RoomReminderConfiguration,
    window: ReminderSchedulerWindow,
    after: ReminderCandidateCursor | undefined,
    _limit: 1,
    signal: AbortSignal,
  ): Promise<readonly ReminderDueCandidate[]> {
    throwIfAborted(signal);
    const state = this.getWindowCache(window);
    const key = configurationKey(configuration);
    let candidates = state.configurations.get(key);
    if (!candidates) {
      if (state.configurations.size >= MAX_CONFIGURATIONS_PER_WINDOW) {
        throw new CanonicalReminderSourceError('scan-limit');
      }
      const selected = await this.loadSelectedResource(configuration, signal);
      candidates = selected
        ? await this.projectDueCandidates(
            selected,
            configuration,
            window,
            state,
            signal,
          )
        : [];
      state.configurations.set(key, candidates);
    }

    throwIfAborted(signal);
    const candidate = candidates.find(({ candidate: value }) =>
      isAfterCandidateCursor(value, after),
    );
    return candidate ? [candidate.candidate] : [];
  }

  async resolveCurrentDelivery(
    configuration: RoomReminderConfiguration,
    identity: ReminderDueCandidate['identity'],
    window: ReminderSchedulerWindow,
    signal: AbortSignal,
  ): Promise<ResolvedReminderDelivery | undefined> {
    throwIfAborted(signal);
    if (
      identity.roomId !== configuration.roomId ||
      identity.calendarId !== configuration.calendarId ||
      identity.eventUid !== configuration.eventUid ||
      identity.alarmUid !== configuration.alarmUid ||
      identity.recurrenceId.trim().length === 0
    ) {
      return undefined;
    }

    const state = this.getWindowCache(window);
    const selected = await this.loadSelectedResource(configuration, signal);
    if (!selected) return undefined;
    const currentCandidates = await this.projectDueCandidates(
      selected,
      configuration,
      window,
      state,
      signal,
    );
    const matches = currentCandidates.filter(
      ({ candidate }) =>
        candidate.identity.recurrenceId === identity.recurrenceId &&
        candidate.identity.triggerOrdinal === identity.triggerOrdinal,
    );
    if (matches.length !== 1) return undefined;
    return {
      dueAt: matches[0].candidate.dueAt,
      body: matches[0].body,
    };
  }

  private getWindowCache(window: ReminderSchedulerWindow): WindowCache {
    const key = `${window.notBefore.toISOString()}\u0000${window.through.toISOString()}`;
    if (this.windowCache?.key !== key) {
      this.windowCache = { key, chunksUsed: 0, configurations: new Map() };
    }
    return this.windowCache;
  }

  private async loadSelectedResource(
    configuration: RoomReminderConfiguration,
    signal: AbortSignal,
  ): Promise<SelectedResource | undefined> {
    throwIfAborted(signal);
    const target: RoomCalendarTarget = {
      roomId: configuration.roomId,
      calendarId: configuration.calendarId,
      principal: { kind: 'service' },
    };
    try {
      const principal = await this.roomCalendarAccess.forAuthorizedTarget(
        target,
        'read',
        signal,
      );
      const client = new CalDavEventClient(
        this.credentialProviderFactory.forPrincipal(
          principal.userId,
          principal.credential,
        ),
        this.fetchImpl,
        this.appConfig.caldav_max_event_response_bytes ??
          DEFAULT_CALDAV_EVENT_RESPONSE_MAX_BYTES,
      );
      const resources = await client.listEventsByUid(
        principal.calendarUrl,
        configuration.eventUid,
        signal,
      );
      throwIfAborted(signal);
      if (resources.length > MAX_EVENT_UID_REPORT_RESOURCES) {
        throw new CanonicalReminderSourceError('ambiguous-resource');
      }

      const matching: SelectedResource[] = [];
      for (const resource of resources) {
        throwIfAborted(signal);
        const resourceData = {
          calendarId: configuration.calendarId,
          icalendar: resource.icalendar,
        } satisfies CanonicalReminderResourceData;
        let selection: CanonicalReminderResourceSelection;
        try {
          selection = resolveCanonicalReminderResourceSelection(
            {
              calendarId: configuration.calendarId,
              eventUid: configuration.eventUid,
              recurrenceId: configuration.recurrenceId,
              alarmUid: configuration.alarmUid,
            },
            resourceData,
          );
        } catch (error) {
          if (isResolutionCode(error, NO_MATCH_CODES)) continue;
          throw error;
        }

        resolveTriggerableReminderIdentity(
          {
            calendarId: configuration.calendarId,
            eventUid: configuration.eventUid,
            recurrenceId: configuration.recurrenceId,
            alarmUid: configuration.alarmUid,
          },
          resourceData,
        );
        const parsed = new ICalendarEventCodec().parse(
          configuration.calendarId,
          resource.href,
          resource.icalendar,
        );
        if (
          parsed.event.uid !== configuration.eventUid ||
          parsed.listProjectionDiagnostic === 'unsupported-recurrence' ||
          parsed.event.unsupportedTimezone ||
          parsed.event.unsupportedRecurrence
        ) {
          throw new CanonicalReminderSourceError('unsupported-source');
        }
        validateRecurrenceSubset(parsed.event);
        matching.push({
          resource: {
            href: resource.href,
            etag: resource.etag,
            ...resourceData,
          },
          selection,
          event: parsed.event,
        });
      }

      if (matching.length > 1) {
        throw new CanonicalReminderSourceError('ambiguous-resource');
      }
      return matching[0];
    } catch (error) {
      if (signal.aborted) throw abortError();
      if (error instanceof CanonicalReminderSourceError) throw error;
      throw new CanonicalReminderSourceError('unavailable');
    }
  }

  private async projectDueCandidates(
    selected: SelectedResource,
    configuration: RoomReminderConfiguration,
    window: ReminderSchedulerWindow,
    state: WindowCache,
    signal: AbortSignal,
  ): Promise<readonly MaterializedReminderCandidate[]> {
    const { start, end } = searchRange(window);
    const result = new Map<string, MaterializedReminderCandidate>();
    const maximumRepeat = repeatCount(selected.selection.alarm);
    let cursor = start;
    let chunksForConfiguration = 0;

    while (cursor < end) {
      throwIfAborted(signal);
      if (
        chunksForConfiguration >= MAX_PROJECTION_CHUNKS_PER_SCAN ||
        state.chunksUsed >= MAX_PROJECTION_CHUNKS_PER_RUN
      ) {
        throw new CanonicalReminderSourceError('scan-limit');
      }
      chunksForConfiguration += 1;
      state.chunksUsed += 1;
      const chunkEnd = Math.min(cursor + MAX_PROJECTION_CHUNK_MS, end);
      const range: CalendarTimeRange = {
        start: new Date(cursor).toISOString(),
        end: new Date(chunkEnd).toISOString(),
      };
      const projection = projectCalendarEventOccurrences(
        [selected.event],
        range,
        'UTC',
        signal,
      );
      throwIfAborted(signal);
      if (projection.diagnostics.length > 0) {
        throw new CanonicalReminderSourceError('unsupported-source');
      }

      for (const occurrence of projection.occurrences) {
        throwIfAborted(signal);
        if (occurrence.event.status === 'cancelled') continue;
        if (
          configuration.recurrenceId !== null &&
          !projectedRecurrenceMatchesIdentity(
            configuration.recurrenceId,
            occurrence.recurrenceId,
          )
        ) {
          continue;
        }
        const recurrenceId = encodeCanonicalReminderFiringRecurrenceIdentity(
          selected.selection,
          occurrence.recurrenceId,
        );
        if (
          configuration.recurrenceId === null &&
          selected.selection.relatedRecurrenceIdentities.includes(recurrenceId)
        ) {
          // A master alarm is selected only for master-generated instances.
          // Detached overrides require their own explicit alarm configuration.
          continue;
        }
        if (
          configuration.recurrenceId !== null &&
          recurrenceId !== configuration.recurrenceId
        ) {
          continue;
        }
        const occurrenceTiming = resolveProjectedReminderOccurrenceTiming(
          selected.selection,
          occurrence.event.timing,
        );
        if (
          !isReminderScheduleWithinLimits(
            selected.selection.alarmSource,
            occurrenceTiming,
          )
        ) {
          throw new CanonicalReminderSourceError('unsupported-source');
        }

        const dueFirings: Array<{ triggerOrdinal: number; dueAt: Date }> = [];
        for (
          let triggerOrdinal = 0;
          triggerOrdinal <= maximumRepeat;
          triggerOrdinal += 1
        ) {
          throwIfAborted(signal);
          const dueAt = calculateDisplayReminderDueAt(
            selected.selection.alarmSource,
            occurrenceTiming,
            triggerOrdinal,
          );
          if (!dueAt) {
            throw new CanonicalReminderSourceError('unsupported-source');
          }
          if (!isDueAt(dueAt, window)) continue;
          dueFirings.push({ triggerOrdinal, dueAt });
        }
        if (dueFirings.length === 0) continue;

        for (const { triggerOrdinal, dueAt } of dueFirings) {
          throwIfAborted(signal);
          const candidate: ReminderDueCandidate = {
            identity: {
              roomId: configuration.roomId,
              calendarId: configuration.calendarId,
              eventUid: configuration.eventUid,
              recurrenceId,
              alarmUid: configuration.alarmUid,
              triggerOrdinal,
            },
            dueAt,
          };
          const key = candidateKey(candidate);
          const existing = result.get(key);
          if (
            existing &&
            existing.candidate.dueAt.getTime() !== dueAt.getTime()
          ) {
            throw new CanonicalReminderSourceError('unsupported-source');
          }
          if (!existing) {
            result.set(key, {
              candidate,
              body: reminderBody(occurrence.event.title),
            });
            if (result.size > MAX_CANDIDATES_PER_CONFIGURATION) {
              throw new CanonicalReminderSourceError('scan-limit');
            }
          }
        }
      }

      cursor = chunkEnd;
      await this.yieldToEventLoop(signal);
      throwIfAborted(signal);
    }

    return [...result.values()].sort(compareMaterializedCandidates);
  }
}

function searchRange(window: ReminderSchedulerWindow): {
  start: number;
  end: number;
} {
  const lead = MAX_REMINDER_TRIGGER_HORIZON_MS + MAX_REMINDER_EVENT_DURATION_MS;
  return {
    start: window.notBefore.getTime() - lead - 2 * MAX_TIMEZONE_MARGIN_MS,
    end:
      window.through.getTime() +
      MAX_REMINDER_TRIGGER_HORIZON_MS +
      2 * MAX_TIMEZONE_MARGIN_MS,
  };
}

function validateRecurrenceSubset(event: CalendarEvent): void {
  const rule = event.recurrence?.rrule;
  if (!rule) return;
  const anchor = eventAnchor(event.timing);
  if (!anchor) throw new CanonicalReminderSourceError('unsupported-source');
  try {
    parseSupportedCalendarEventRecurrenceRule(rule, anchor);
  } catch {
    throw new CanonicalReminderSourceError('unsupported-source');
  }
}

function eventAnchor(
  timing: CalendarEventTiming,
): CalendarEventDateTime | undefined {
  if (timing.type === 'all-day') {
    return { type: 'date', value: timing.startDate };
  }
  if (timing.start.type === 'floating') {
    return { type: 'floating-date-time', value: timing.start.local };
  }
  return {
    type: 'date-time',
    value: { local: timing.start.local, timezone: timing.start.timezone },
  };
}

function repeatCount(alarm: ICAL.Component): number {
  const values = alarm.getAllProperties('repeat');
  if (values.length === 0) return 0;
  if (values.length !== 1) {
    throw new CanonicalReminderSourceError('unsupported-source');
  }
  const value = values[0].getFirstValue();
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_REMINDER_REPEAT_COUNT
  ) {
    throw new CanonicalReminderSourceError('unsupported-source');
  }
  return value;
}

function projectedRecurrenceMatchesIdentity(
  identity: string,
  projected?: CalendarEventDateTime,
): boolean {
  if (!projected) return false;
  let tuple: unknown;
  try {
    tuple = JSON.parse(identity);
  } catch {
    return false;
  }
  if (!Array.isArray(tuple)) return false;

  if (projected.type === 'date') {
    return tuple[0] === 'date' && tuple[1] === projected.value;
  }
  if (projected.type === 'floating-date-time') {
    return (
      tuple[0] === 'date-time' &&
      tuple[1] === 'floating' &&
      tuple[3] === projected.value
    );
  }

  const expectedTimezone =
    tuple[1] === 'utc' ? 'UTC' : tuple[1] === 'tzid' ? tuple[2] : undefined;
  return (
    tuple[0] === 'date-time' &&
    tuple[3] === projected.value.local &&
    expectedTimezone === projected.value.timezone
  );
}

function reminderBody(title: string): string {
  const normalizedTitle = title
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const prefix = 'Reminder: ';
  const maxTitleBytes = MAX_REMINDER_BODY_BYTES - Buffer.byteLength(prefix);
  const safeTitle =
    Buffer.byteLength(normalizedTitle, 'utf8') <= maxTitleBytes
      ? normalizedTitle
      : `${Buffer.from(normalizedTitle, 'utf8')
          .subarray(0, maxTitleBytes - 3)
          .toString('utf8')
          .replace(/\uFFFD$/u, '')}…`;
  return `${prefix}${safeTitle || 'Untitled event'}`;
}

function isDueAt(dueAt: Date, window: ReminderSchedulerWindow): boolean {
  return (
    Number.isFinite(dueAt.getTime()) &&
    dueAt.getTime() >= window.notBefore.getTime() &&
    dueAt.getTime() <= window.through.getTime()
  );
}

function isAfterCandidateCursor(
  candidate: ReminderDueCandidate,
  after: ReminderCandidateCursor | undefined,
): boolean {
  if (!after) return true;
  return (
    candidate.identity.recurrenceId > after.recurrenceId ||
    (candidate.identity.recurrenceId === after.recurrenceId &&
      candidate.identity.triggerOrdinal > after.triggerOrdinal)
  );
}

function candidateKey(candidate: ReminderDueCandidate): string {
  return `${candidate.identity.recurrenceId}\u0000${candidate.identity.triggerOrdinal.toString().padStart(3, '0')}`;
}

function compareMaterializedCandidates(
  left: MaterializedReminderCandidate,
  right: MaterializedReminderCandidate,
): number {
  return (
    compareText(
      left.candidate.identity.recurrenceId,
      right.candidate.identity.recurrenceId,
    ) ||
    left.candidate.identity.triggerOrdinal -
      right.candidate.identity.triggerOrdinal
  );
}

function configurationKey(configuration: RoomReminderConfiguration): string {
  return JSON.stringify([
    configuration.roomId,
    configuration.calendarId,
    configuration.eventUid,
    configuration.recurrenceId,
    configuration.alarmUid,
  ]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isResolutionCode(error: unknown, codes: ReadonlySet<string>): boolean {
  return (
    error instanceof CanonicalReminderResolutionError && codes.has(error.code)
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError');
}

function yieldToEventLoop(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const handle = setImmediate(() => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(abortError());
      else resolve();
    });
    const abort = () => {
      clearImmediate(handle);
      reject(abortError());
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
