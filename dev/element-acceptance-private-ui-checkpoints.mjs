import { appendFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export const PRIVATE_UI_CHECKPOINT_PHASES = Object.freeze([
  'private-ui-fixture-ready',
  'private-ui-member-a-auth',
  'private-ui-member-a-room',
  'private-ui-member-a-widget-ready',
  'private-ui-dialog-open',
  'private-ui-initial-list',
  'private-ui-calendar-select',
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

const checkpointPhases = new Set(PRIVATE_UI_CHECKPOINT_PHASES);
const testStatuses = new Set([
  'passed',
  'failed',
  'timedOut',
  'skipped',
  'interrupted',
  'unknown',
]);

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
  let finished = false;

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
     * Run best-effort teardown even when Playwright has already finalized the
     * test result. A finalized receipt remains immutable while teardown
     * errors never replace the test result.
     *
     * @template T
     * @param {string} phase
     * @param {() => Promise<T> | T} operation
     * @returns {Promise<T | undefined>}
     */
    async cleanup(phase, operation) {
      if (!checkpointPhases.has(phase) || typeof operation !== 'function') {
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
        if (checkpointStarted && !finished) {
          activePhase = null;
          failurePhase ??= phase;
          try {
            writeRecord({ phase, status: 'failed' });
          } catch {
            // Keep the test result and never retain a teardown error.
          }
        }
        return undefined;
      }
    },

    /**
     * Preserve Playwright's structured result, including a timeout, without
     * retaining its error, attachments, or other test data.
     *
     * @param {string} testStatus
     */
    finish(testStatus) {
      if (finished) return;
      const boundedTestStatus = testStatuses.has(testStatus)
        ? testStatus
        : 'unknown';
      if (activePhase) {
        failurePhase = activePhase;
        writeRecord({ phase: activePhase, status: 'failed' });
        activePhase = null;
      }
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
    },
  };
}
