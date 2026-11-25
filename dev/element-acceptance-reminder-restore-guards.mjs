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

import { isAbsolute, resolve, sep } from 'node:path';

const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/u;
const REMINDER_CONFIGURATION_SNAPSHOT_KEYS = [
  'roomId',
  'calendarId',
  'eventUid',
  'recurrenceId',
  'alarmUid',
  'target',
  'allDaySchedule',
  'scheduleEffectiveAt',
  'revision',
];

/** Parse the private, one-JSON-object-per-line Postgres reminder snapshot. */
export function parseReminderConfigurationSnapshotOutput(output) {
  if (typeof output !== 'string')
    throw new TypeError('invalid snapshot output');
  const lines = output.trim() ? output.trim().split(/\r?\n/u) : [];
  const configurations = [];
  const identities = new Set();

  for (const line of lines) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new TypeError('invalid reminder configuration snapshot');
    }
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !==
        [...REMINDER_CONFIGURATION_SNAPSHOT_KEYS].sort().join(',')
    ) {
      throw new TypeError('invalid reminder configuration snapshot');
    }
    for (const key of ['roomId', 'calendarId', 'eventUid', 'alarmUid']) {
      if (
        typeof value[key] !== 'string' ||
        value[key].trim() !== value[key] ||
        !value[key]
      ) {
        throw new TypeError('invalid reminder configuration snapshot');
      }
    }
    if (
      value.recurrenceId !== null &&
      (typeof value.recurrenceId !== 'string' ||
        value.recurrenceId.trim() !== value.recurrenceId ||
        !value.recurrenceId)
    ) {
      throw new TypeError('invalid reminder configuration snapshot');
    }
    if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
      throw new TypeError('invalid reminder configuration snapshot');
    }

    const target = value.target;
    if (target?.kind === 'room') {
      if (
        target === null ||
        typeof target !== 'object' ||
        Array.isArray(target) ||
        Object.keys(target).length !== 1 ||
        !Object.hasOwn(target, 'kind')
      ) {
        throw new TypeError('invalid reminder configuration snapshot');
      }
    } else if (target?.kind === 'users') {
      if (
        typeof target !== 'object' ||
        Array.isArray(target) ||
        Object.keys(target).length !== 2 ||
        !Array.isArray(target.userIds) ||
        target.userIds.length < 1 ||
        target.userIds.length > 50 ||
        target.userIds.some(
          (userId) =>
            typeof userId !== 'string' ||
            userId.length > 255 ||
            !/^@[^:\s?#]+:[^\s?#]+$/u.test(userId),
        ) ||
        new Set(target.userIds).size !== target.userIds.length ||
        target.userIds.some(
          (userId, index) => index > 0 && target.userIds[index - 1] >= userId,
        )
      ) {
        throw new TypeError('invalid reminder configuration snapshot');
      }
    } else {
      throw new TypeError('invalid reminder configuration snapshot');
    }

    const schedule = value.allDaySchedule;
    if (schedule !== null) {
      if (
        schedule === null ||
        typeof schedule !== 'object' ||
        Array.isArray(schedule) ||
        Object.keys(schedule).sort().join(',') !==
          'daysBefore,localTime,timezone' ||
        !Number.isSafeInteger(schedule.daysBefore) ||
        schedule.daysBefore < 0 ||
        schedule.daysBefore > 366 ||
        typeof schedule.localTime !== 'string' ||
        !/^([01][0-9]|2[0-3]):[0-5][0-9]$/u.test(schedule.localTime) ||
        typeof schedule.timezone !== 'string' ||
        schedule.timezone.trim() !== schedule.timezone ||
        schedule.timezone.length < 1 ||
        schedule.timezone.length > 64 ||
        /\s/u.test(schedule.timezone)
      ) {
        throw new TypeError('invalid reminder configuration snapshot');
      }
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: schedule.timezone });
      } catch {
        throw new TypeError('invalid reminder configuration snapshot');
      }
    }
    const scheduleEffectiveAt = value.scheduleEffectiveAt;
    if (
      (schedule === null && scheduleEffectiveAt !== null) ||
      (schedule !== null &&
        (!Number.isSafeInteger(scheduleEffectiveAt) ||
          scheduleEffectiveAt <= 0))
    ) {
      throw new TypeError('invalid reminder configuration snapshot');
    }

    const identity = JSON.stringify([
      value.roomId,
      value.calendarId,
      value.eventUid,
      value.recurrenceId,
      value.alarmUid,
    ]);
    if (identities.has(identity)) {
      throw new TypeError('duplicate reminder configuration snapshot');
    }
    identities.add(identity);
    configurations.push({
      roomId: value.roomId,
      calendarId: value.calendarId,
      eventUid: value.eventUid,
      recurrenceId: value.recurrenceId,
      alarmUid: value.alarmUid,
      target:
        target.kind === 'room'
          ? { kind: 'room' }
          : { kind: 'users', userIds: [...target.userIds] },
      allDaySchedule:
        schedule === null
          ? null
          : {
              daysBefore: schedule.daysBefore,
              localTime: schedule.localTime,
              timezone: schedule.timezone,
            },
      scheduleEffectiveAt,
      revision: value.revision,
    });
  }

  return configurations;
}

export function sameReminderConfigurationSnapshots(expected, actual) {
  if (!Array.isArray(expected) || !Array.isArray(actual)) return false;
  if (expected.length !== actual.length) return false;
  const expectedRows = expected.map((configuration) =>
    JSON.stringify(configuration),
  );
  const actualRows = actual.map((configuration) =>
    JSON.stringify(configuration),
  );
  expectedRows.sort();
  actualRows.sort();
  return expectedRows.every(
    (configuration, index) => configuration === actualRows[index],
  );
}

/** Return whether every captured configuration is still present unchanged. */
export function preservesReminderConfigurationSnapshots(expected, actual) {
  if (!Array.isArray(expected) || !Array.isArray(actual)) return false;
  if (expected.length > actual.length) return false;
  const actualRows = new Set(
    actual.map((configuration) => JSON.stringify(configuration)),
  );
  return expected.every((configuration) =>
    actualRows.has(JSON.stringify(configuration)),
  );
}

export function sameReminderDeliverySnapshots(expected, actual) {
  const normalize = (rows) => {
    if (!Array.isArray(rows)) return undefined;
    const seen = new Set();
    const normalized = [];
    for (const row of rows) {
      if (
        row === null ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        Object.keys(row).sort().join(',') !==
          'attemptCount,deliveryKey,skipReason,state' ||
        typeof row.deliveryKey !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(row.deliveryKey) ||
        !Number.isSafeInteger(row.attemptCount) ||
        row.attemptCount < 1 ||
        !['sent', 'skipped'].includes(row.state) ||
        (row.state === 'sent' && row.skipReason !== null) ||
        (row.state === 'skipped' &&
          row.skipReason !== 'no-current-recipients') ||
        seen.has(row.deliveryKey)
      ) {
        return undefined;
      }
      seen.add(row.deliveryKey);
      normalized.push({
        deliveryKey: row.deliveryKey,
        attemptCount: row.attemptCount,
        state: row.state,
        skipReason: row.skipReason,
      });
    }
    return normalized;
  };
  const expectedRows = normalize(expected);
  const actualRows = normalize(actual);
  if (
    !expectedRows ||
    !actualRows ||
    expectedRows.length !== actualRows.length
  ) {
    return false;
  }
  const serialize = (rows) => rows.map((row) => JSON.stringify(row)).sort();
  const expectedSerialized = serialize(expectedRows);
  const actualSerialized = serialize(actualRows);
  return expectedSerialized.every(
    (row, index) => row === actualSerialized[index],
  );
}

export function isPrivateArtifactPath(path, runnerTemp) {
  return (
    typeof path === 'string' &&
    typeof runnerTemp === 'string' &&
    isAbsolute(path) &&
    resolve(path).startsWith(resolve(runnerTemp) + sep)
  );
}

export function isSafeRestoreTargetPlan({
  projectName,
  sourceVolumeName,
  restoreVolumeName,
  restoreVolumeExists,
  sourceDatabase,
  restoreDatabase,
  restoreDatabaseExists,
}) {
  return (
    typeof projectName === 'string' &&
    PROJECT_NAME.test(projectName) &&
    sourceVolumeName === `${projectName}_radicale-data` &&
    restoreVolumeName === `${projectName}_radicale-restore` &&
    restoreVolumeName !== sourceVolumeName &&
    restoreVolumeExists === false &&
    sourceDatabase === 'matrix_calendar_test' &&
    restoreDatabase === 'matrix_calendar_restored' &&
    restoreDatabase !== sourceDatabase &&
    restoreDatabaseExists === false
  );
}

export function inspectStoppedContainerState(state) {
  const stopped = state?.status === 'exited';
  const gracefulExit = state?.exitCode === 0 || state?.exitCode === 143;
  const oomFree = state?.oomKilled === false;
  return {
    stopped,
    gracefulExit,
    oomFree,
    accepted: stopped && gracefulExit && oomFree,
  };
}

export function getRestoreQuiescePlan(skipElement) {
  if (typeof skipElement !== 'boolean') {
    throw new TypeError('skipElement must be a boolean');
  }

  return {
    stopServices: skipElement ? ['widget'] : ['element', 'widget'],
    inspectServices: skipElement
      ? ['widget', 'gateway', 'radicale']
      : ['element', 'widget', 'gateway', 'radicale'],
    elementQuiesceSkipped: skipElement,
  };
}
