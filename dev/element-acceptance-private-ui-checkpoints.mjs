import { appendFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { projectPrivateUiRoomReadinessObservation } from './element-room-context-observation.mjs';

export const PRIVATE_UI_CHECKPOINT_PHASES = Object.freeze([
  'private-ui-fixture-ready',
  'private-ui-member-a-auth',
  'private-ui-member-a-room',
  'private-ui-member-a-widget-ready',
  'private-ui-access-button-visible',
  'private-ui-access-button-enabled',
  'private-ui-access-button-click',
  'private-ui-dialog-visible',
  'private-ui-initial-list',
  'private-ui-calendar-picker-open',
  'private-ui-calendar-option-unique',
  'private-ui-calendar-selection',
  'private-ui-calendar-selection-complete',
  'private-ui-credential-issue-reveal',
  'private-ui-no-publication',
  'private-ui-credential-hide',
  'private-ui-storage-check',
  'private-ui-list-reopen',
  'private-ui-dav-principal-discovery',
  'private-ui-dav-collection-discovery',
  'private-ui-dav-create',
  'private-ui-dav-read-created',
  'private-ui-dav-update',
  'private-ui-dav-read-updated',
  'private-ui-dav-delete',
  'private-ui-dav-cleanup',
  'private-ui-member-b-auth',
  'private-ui-member-b-room',
  'private-ui-member-b-widget-ready',
  'private-ui-member-b-deny',
  'private-ui-outsider-auth',
  'private-ui-outsider-room',
  'private-ui-outsider-widget-ready',
  'private-ui-outsider-deny',
  'private-ui-revoke',
  'private-ui-dav-deny-after-revoke',
  'private-ui-egress-check',
  'private-ui-context-cleanup',
]);

export const PRIVATE_UI_RESULT_PHASE = 'private-ui-test-result';
export const PRIVATE_UI_CALENDAR_LIST_TRANSPORT_PHASE =
  'private-ui-calendar-list-transport';
export const PRIVATE_UI_CALENDAR_SELECTION_DIAGNOSTIC_PHASE =
  'private-ui-calendar-selection-diagnostic';
export const PRIVATE_UI_ROOM_READINESS_PHASE = 'private-ui-room-readiness';
export const PRIVATE_UI_CALENDAR_LIST_ENDPOINTS = Object.freeze([
  'personal-list',
  'room-context',
  'room-list',
]);
export const PRIVATE_UI_CALENDAR_LIST_METHODS = Object.freeze([
  'GET',
  'OPTIONS',
]);
export const PRIVATE_UI_CALENDAR_LIST_FAILURE_CATEGORIES = Object.freeze([
  'blocked',
  'dns',
  'tls',
  'timeout',
  'connection',
  'other',
]);
export const PRIVATE_UI_CALENDAR_LIST_OBSERVATION_LIMIT = 6;

const checkpointPhases = new Set(PRIVATE_UI_CHECKPOINT_PHASES);
const cleanupPhases = new Set([
  'private-ui-dav-cleanup',
  'private-ui-context-cleanup',
]);
const calendarListEndpoints = new Set(PRIVATE_UI_CALENDAR_LIST_ENDPOINTS);
const calendarListMethods = new Set(PRIVATE_UI_CALENDAR_LIST_METHODS);
const calendarListFailureCategories = new Set(
  PRIVATE_UI_CALENDAR_LIST_FAILURE_CATEGORIES,
);
const calendarSelectionBranches = new Set([
  'unavailable',
  'already-selected',
  'changed',
]);
const testStatuses = new Set([
  'passed',
  'failed',
  'timedOut',
  'skipped',
  'interrupted',
  'unknown',
]);

/**
 * Map a Playwright browser network error to a closed diagnostic category.
 * The input is never copied into a checkpoint or returned to the caller.
 *
 * @param {unknown} errorText
 * @returns {'blocked' | 'dns' | 'tls' | 'timeout' | 'connection' | 'other'}
 */
export function classifyPrivateUiCalendarListNetworkFailure(errorText) {
  const normalized =
    typeof errorText === 'string' ? errorText.toUpperCase() : '';
  if (normalized.includes('ERR_CERT') || normalized.includes('ERR_SSL')) {
    return 'tls';
  }
  if (normalized.includes('ERR_BLOCKED_BY_CLIENT')) return 'blocked';
  if (normalized.includes('ERR_NAME_NOT_RESOLVED')) return 'dns';
  if (
    normalized.includes('ERR_TIMED_OUT') ||
    normalized.includes('ERR_CONNECTION_TIMED_OUT')
  ) {
    return 'timeout';
  }
  if (
    normalized.includes('ERR_CONNECTION') ||
    normalized.includes('ERR_NETWORK_CHANGED')
  ) {
    return 'connection';
  }
  return 'other';
}

/**
 * Return a strict, copied calendar-list transport summary or undefined.
 *
 * @param {unknown} observations
 * @returns {Array<{
 *   endpoint: string,
 *   method: string,
 *   outcome: string,
 *   httpStatus?: number,
 *   networkFailure?: string
 * }> | undefined}
 */
export function normalizePrivateUiCalendarListTransportObservations(
  observations,
) {
  if (
    !Array.isArray(observations) ||
    observations.length > PRIVATE_UI_CALENDAR_LIST_OBSERVATION_LIMIT
  ) {
    return undefined;
  }

  const seen = new Set();
  const normalized = [];
  for (const observation of observations) {
    if (
      observation === null ||
      typeof observation !== 'object' ||
      Array.isArray(observation)
    ) {
      return undefined;
    }
    const { endpoint, method, outcome } = observation;
    const key = `${endpoint}:${method}`;
    const exactKeys = (keys) =>
      Object.keys(observation).length === keys.length &&
      keys.every((field) => Object.hasOwn(observation, field));
    if (
      !calendarListEndpoints.has(endpoint) ||
      !calendarListMethods.has(method) ||
      seen.has(key)
    ) {
      return undefined;
    }
    seen.add(key);

    if (outcome === 'pending' && exactKeys(['endpoint', 'method', 'outcome'])) {
      normalized.push({ endpoint, method, outcome });
      continue;
    }
    if (
      outcome === 'response' &&
      exactKeys(['endpoint', 'method', 'outcome', 'httpStatus']) &&
      Number.isInteger(observation.httpStatus) &&
      observation.httpStatus >= 100 &&
      observation.httpStatus <= 599
    ) {
      normalized.push({
        endpoint,
        method,
        outcome,
        httpStatus: observation.httpStatus,
      });
      continue;
    }
    if (
      outcome === 'network-failure' &&
      exactKeys(['endpoint', 'method', 'outcome', 'networkFailure']) &&
      calendarListFailureCategories.has(observation.networkFailure)
    ) {
      normalized.push({
        endpoint,
        method,
        outcome,
        networkFailure: observation.networkFailure,
      });
      continue;
    }
    return undefined;
  }
  return normalized;
}

/**
 * Return a strict, copied summary of private calendar selection progress.
 *
 * @param {unknown} observation
 * @returns {{ branch: string, clickCompleted: boolean, httpStatus: number | null } | undefined}
 */
export function normalizePrivateUiCalendarSelectionObservation(observation) {
  if (
    observation === null ||
    typeof observation !== 'object' ||
    Array.isArray(observation) ||
    Object.keys(observation).length !== 3 ||
    !Object.hasOwn(observation, 'branch') ||
    !Object.hasOwn(observation, 'clickCompleted') ||
    !Object.hasOwn(observation, 'httpStatus') ||
    !calendarSelectionBranches.has(observation.branch) ||
    typeof observation.clickCompleted !== 'boolean' ||
    (observation.httpStatus !== null &&
      (!Number.isInteger(observation.httpStatus) ||
        observation.httpStatus < 100 ||
        observation.httpStatus > 599))
  ) {
    return undefined;
  }

  if (
    (observation.branch === 'unavailable' &&
      (observation.clickCompleted || observation.httpStatus !== null)) ||
    (observation.branch === 'already-selected' &&
      (observation.clickCompleted || observation.httpStatus !== null)) ||
    (observation.branch === 'changed' &&
      !observation.clickCompleted &&
      observation.httpStatus !== null)
  ) {
    return undefined;
  }

  return {
    branch: observation.branch,
    clickCompleted: observation.clickCompleted,
    httpStatus: observation.httpStatus,
  };
}

/**
 * Create a source-bound journal for the opt-in private acceptance test.
 * Records contain only closed phase names and fixed status/profile values.
 *
 * @param {{ stageFile: string, sourceSha: string, profile: string }} options
 */
export function createPrivateUiCheckpointJournal({
  stageFile,
  sourceSha,
  profile,
}) {
  if (
    typeof stageFile !== 'string' ||
    !isAbsolute(stageFile) ||
    typeof sourceSha !== 'string' ||
    !/^[a-f0-9]{40}$/iu.test(sourceSha) ||
    profile !== 'normal-bot'
  ) {
    throw new Error('Private acceptance checkpoints are unavailable');
  }

  const boundSourceSha = sourceSha.toLowerCase();
  let lastEnteredPhase = null;
  let lastCompletedPhase = null;
  let activePhase = null;
  let failurePhase = null;
  let cleanupFailed = false;
  let finished = false;
  let calendarListTransportRecorded = false;
  let calendarSelectionObservationRecorded = false;
  let roomReadinessRecorded = false;

  const writeRecord = (record) => {
    try {
      appendFileSync(
        stageFile,
        `${JSON.stringify({
          ...record,
          sourceSha: boundSourceSha,
          profile: 'normal-bot',
        })}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
    } catch {
      throw new Error('Private acceptance checkpoints are unavailable');
    }
  };

  return {
    /**
     * Record the fixed phase before invoking and awaiting its operation.
     *
     * @template T
     * @param {string} phase
     * @param {() => Promise<T> | T} operation
     * @returns {Promise<T>}
     */
    async run(phase, operation) {
      if (!checkpointPhases.has(phase) || typeof operation !== 'function') {
        throw new Error('Private acceptance checkpoint is invalid');
      }
      if (finished) {
        throw new Error('Private acceptance checkpoints are complete');
      }

      lastEnteredPhase = phase;
      activePhase = phase;
      writeRecord({ phase, status: 'started' });
      try {
        const value = await operation();
        if (finished) return value;
        writeRecord({ phase, status: 'passed' });
        lastCompletedPhase = phase;
        activePhase = null;
        return value;
      } catch (error) {
        if (!finished) {
          activePhase = null;
          failurePhase = phase;
          try {
            writeRecord({ phase, status: 'failed' });
          } catch {
            // Keep the original test failure and never retain its message.
          }
        }
        throw error;
      }
    },

    /**
     * Run teardown even when Playwright has already finalized the test result.
     * A new pre-finalization cleanup error fails acceptance; a prior test
     * failure remains primary. A finalized receipt is immutable.
     *
     * @template T
     * @param {'private-ui-dav-cleanup' | 'private-ui-context-cleanup'} phase
     * @param {() => Promise<T> | T} operation
     * @returns {Promise<T | undefined>}
     */
    async cleanup(phase, operation) {
      if (!cleanupPhases.has(phase) || typeof operation !== 'function') {
        throw new Error('Private acceptance checkpoint is invalid');
      }

      let checkpointStarted = false;
      if (!finished) {
        try {
          writeRecord({ phase, status: 'started' });
          checkpointStarted = true;
          lastEnteredPhase = phase;
          activePhase = phase;
        } catch {
          // Teardown still runs if writing diagnostics is unavailable.
        }
      }

      try {
        const value = await operation();
        if (checkpointStarted && !finished) {
          try {
            writeRecord({ phase, status: 'passed' });
            lastCompletedPhase = phase;
            activePhase = null;
          } catch {
            activePhase = null;
            failurePhase ??= phase;
          }
        }
        return value;
      } catch {
        const hadPriorFailure = failurePhase !== null;
        if (checkpointStarted && !finished) {
          activePhase = null;
          if (!hadPriorFailure) failurePhase = phase;
          try {
            writeRecord({ phase, status: 'failed' });
          } catch {
            // Keep the test result and never retain a teardown error.
          }
        }
        if (!finished && !hadPriorFailure) {
          cleanupFailed = true;
          throw new Error('Private acceptance cleanup failed');
        }
        return undefined;
      }
    },

    /**
     * Store a bounded summary of the fixed calendar-list/context requests.
     * Request URLs, headers, bodies, and error text are never accepted.
     *
     * @param {unknown} observations
     */
    recordCalendarListTransport(observations) {
      if (finished) {
        throw new Error('Private acceptance checkpoints are complete');
      }
      if (calendarListTransportRecorded) {
        throw new Error('Private acceptance checkpoint is invalid');
      }
      const sanitizedObservations =
        normalizePrivateUiCalendarListTransportObservations(observations);
      if (sanitizedObservations === undefined) {
        throw new Error('Private acceptance checkpoint is invalid');
      }

      writeRecord({
        phase: PRIVATE_UI_CALENDAR_LIST_TRANSPORT_PHASE,
        status: 'observed',
        observations: sanitizedObservations,
      });
      calendarListTransportRecorded = true;
    },

    /**
     * Store only the fixed selection branch, click completion, and response
     * status while the private calendar selection checkpoint is active.
     *
     * @param {unknown} observation
     */
    recordCalendarSelectionObservation(observation) {
      if (finished) {
        throw new Error('Private acceptance checkpoints are complete');
      }
      if (
        calendarSelectionObservationRecorded ||
        activePhase !== 'private-ui-calendar-selection'
      ) {
        throw new Error('Private acceptance checkpoint is invalid');
      }
      const normalizedObservation =
        normalizePrivateUiCalendarSelectionObservation(observation);
      if (normalizedObservation === undefined) {
        throw new Error('Private acceptance checkpoint is invalid');
      }

      writeRecord({
        phase: PRIVATE_UI_CALENDAR_SELECTION_DIAGNOSTIC_PHASE,
        status: 'observed',
        observation: normalizedObservation,
        sourceSha: boundSourceSha,
        profile: 'normal-bot',
      });
      calendarSelectionObservationRecorded = true;
    },

    /**
     * Preserve the bounded existing member-A room observation after the
     * private room checkpoint has failed. This record never changes the
     * checkpoint or first-failure state.
     *
     * @param {unknown} observation
     * @param {boolean} blockedRequestSeen
     */
    recordRoomReadinessObservation(observation, blockedRequestSeen) {
      if (finished) {
        throw new Error('Private acceptance checkpoints are complete');
      }
      if (
        roomReadinessRecorded ||
        lastEnteredPhase !== 'private-ui-member-a-room' ||
        failurePhase !== 'private-ui-member-a-room'
      ) {
        throw new Error('Private acceptance checkpoint is invalid');
      }
      const normalizedObservation = projectPrivateUiRoomReadinessObservation(
        observation,
        blockedRequestSeen,
      );
      if (normalizedObservation === undefined) {
        throw new Error('Private acceptance checkpoint is invalid');
      }

      writeRecord({
        phase: PRIVATE_UI_ROOM_READINESS_PHASE,
        status: 'observed',
        observation: normalizedObservation,
        sourceSha: boundSourceSha,
        profile: 'normal-bot',
      });
      roomReadinessRecorded = true;
    },

    /**
     * Preserve Playwright's structured result, including a timeout, without
     * retaining its error, attachments, or other test data.
     *
     * @param {string} testStatus
     */
    finish(testStatus) {
      if (finished) return;
      const reportedTestStatus = testStatuses.has(testStatus)
        ? testStatus
        : 'unknown';
      const activePhaseAtFinish = activePhase;
      if (activePhase) {
        failurePhase ??= activePhase;
        writeRecord({ phase: activePhase, status: 'failed' });
        activePhase = null;
      }
      const recordedFailureRequiresPromotion =
        reportedTestStatus === 'passed' &&
        (cleanupFailed ||
          failurePhase !== null ||
          activePhaseAtFinish !== null);
      const boundedTestStatus = recordedFailureRequiresPromotion
        ? 'failed'
        : reportedTestStatus;
      const failed = boundedTestStatus !== 'passed';
      const resultStatus = failed
        ? boundedTestStatus === 'skipped'
          ? 'unavailable'
          : 'failed'
        : 'passed';
      writeRecord({
        phase: PRIVATE_UI_RESULT_PHASE,
        status: resultStatus,
        testStatus: boundedTestStatus,
        lastEnteredPhase,
        lastCompletedPhase,
        failurePhase: failed ? (failurePhase ?? lastEnteredPhase) : null,
      });
      finished = true;
      if (recordedFailureRequiresPromotion) {
        throw new Error(
          cleanupFailed
            ? 'Private acceptance cleanup failed'
            : 'Private acceptance phase failed',
        );
      }
    },
  };
}
