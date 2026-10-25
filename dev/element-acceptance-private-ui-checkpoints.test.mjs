import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  classifyPrivateUiCalendarListNetworkFailure,
  createPrivateUiCheckpointJournal,
  PRIVATE_UI_RESULT_PHASE,
} from './element-acceptance-private-ui-checkpoints.mjs';

const sourceSha = 'b'.repeat(40);

test('classifies connection timeout before the broader connection category', () => {
  assert.equal(
    classifyPrivateUiCalendarListNetworkFailure(
      'net::ERR_CONNECTION_TIMED_OUT',
    ),
    'timeout',
  );
  assert.equal(
    classifyPrivateUiCalendarListNetworkFailure('net::ERR_CONNECTION_RESET'),
    'connection',
  );
  assert.equal(
    classifyPrivateUiCalendarListNetworkFailure('net::ERR_TIMED_OUT'),
    'timeout',
  );
  assert.equal(classifyPrivateUiCalendarListNetworkFailure(undefined), 'other');
});

function createStageFile() {
  const directory = mkdtempSync(join(tmpdir(), 'private-ui-checkpoint-'));
  return {
    directory,
    stageFile: join(directory, 'stage.jsonl'),
  };
}

test('writes the entered checkpoint before the operation and stores only closed fields', async () => {
  const { directory, stageFile } = createStageFile();
  try {
    const journal = createPrivateUiCheckpointJournal({
      stageFile,
      sourceSha,
      profile: 'normal-bot',
    });
    const value = await journal.run('private-ui-dav-create', () => {
      const entered = JSON.parse(readFileSync(stageFile, 'utf8'));
      assert.equal(entered.phase, 'private-ui-dav-create');
      assert.equal(entered.status, 'started');
      return true;
    });
    journal.finish('passed');

    const records = readFileSync(stageFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(value, true);
    assert.deepEqual(records, [
      {
        phase: 'private-ui-dav-create',
        status: 'started',
        sourceSha,
        profile: 'normal-bot',
      },
      {
        phase: 'private-ui-dav-create',
        status: 'passed',
        sourceSha,
        profile: 'normal-bot',
      },
      {
        phase: PRIVATE_UI_RESULT_PHASE,
        status: 'passed',
        testStatus: 'passed',
        lastEnteredPhase: 'private-ui-dav-create',
        lastCompletedPhase: 'private-ui-dav-create',
        failurePhase: null,
        sourceSha,
        profile: 'normal-bot',
      },
    ]);
    assert.equal(statSync(stageFile).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('checkpoints successful cleanup before test finalization', async () => {
  const { directory, stageFile } = createStageFile();
  try {
    const journal = createPrivateUiCheckpointJournal({
      stageFile,
      sourceSha,
      profile: 'normal-bot',
    });
    const result = await journal.cleanup(
      'private-ui-context-cleanup',
      () => 'closed',
    );
    journal.finish('passed');

    const records = readFileSync(stageFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(result, 'closed');
    assert.deepEqual(records, [
      {
        phase: 'private-ui-context-cleanup',
        status: 'started',
        sourceSha,
        profile: 'normal-bot',
      },
      {
        phase: 'private-ui-context-cleanup',
        status: 'passed',
        sourceSha,
        profile: 'normal-bot',
      },
      {
        phase: PRIVATE_UI_RESULT_PHASE,
        status: 'passed',
        testStatus: 'passed',
        lastEnteredPhase: 'private-ui-context-cleanup',
        lastCompletedPhase: 'private-ui-context-cleanup',
        failurePhase: null,
        sourceSha,
        profile: 'normal-bot',
      },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('cleanup failure fails acceptance and preserves an earlier phase failure', async () => {
  const { directory, stageFile } = createStageFile();
  try {
    const cleanupJournal = createPrivateUiCheckpointJournal({
      stageFile,
      sourceSha,
      profile: 'normal-bot',
    });
    await assert.rejects(
      cleanupJournal.cleanup('private-ui-context-cleanup', () => {
        throw new Error('private-cleanup-sentinel-do-not-record');
      }),
      { message: 'Private acceptance cleanup failed' },
    );
    assert.throws(() => cleanupJournal.finish('passed'), {
      message: 'Private acceptance cleanup failed',
    });
    const cleanupRecords = readFileSync(stageFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(cleanupRecords[1].status, 'failed');
    assert.equal(cleanupRecords.at(-1).status, 'failed');
    assert.equal(cleanupRecords.at(-1).testStatus, 'failed');
    assert.equal(
      cleanupRecords.at(-1).failurePhase,
      'private-ui-context-cleanup',
    );
    assert.doesNotMatch(
      readFileSync(stageFile, 'utf8'),
      /private-cleanup-sentinel-do-not-record/u,
    );

    const priorFailureStage = join(directory, 'prior-failure.jsonl');
    const priorFailureJournal = createPrivateUiCheckpointJournal({
      stageFile: priorFailureStage,
      sourceSha,
      profile: 'normal-bot',
    });
    await assert.rejects(
      priorFailureJournal.run('private-ui-dav-delete', () => {
        throw new Error('private-primary-sentinel-do-not-record');
      }),
    );
    const cleanupResult = await priorFailureJournal.cleanup(
      'private-ui-dav-cleanup',
      () => {
        throw new Error('private-secondary-sentinel-do-not-record');
      },
    );
    priorFailureJournal.finish('failed');
    const priorFailureRecords = readFileSync(priorFailureStage, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(cleanupResult, undefined);
    assert.equal(priorFailureRecords[1].status, 'failed');
    assert.equal(priorFailureRecords[3].status, 'failed');
    assert.equal(priorFailureRecords.at(-1).testStatus, 'failed');
    assert.equal(
      priorFailureRecords.at(-1).failurePhase,
      'private-ui-dav-delete',
    );
    assert.doesNotMatch(
      readFileSync(priorFailureStage, 'utf8'),
      /private-(?:primary|secondary)-sentinel-do-not-record/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('preserves failed and timed-out test status without retaining operation errors', async () => {
  const { directory, stageFile } = createStageFile();
  try {
    const journal = createPrivateUiCheckpointJournal({
      stageFile,
      sourceSha,
      profile: 'normal-bot',
    });
    await assert.rejects(
      journal.run('private-ui-dav-read-created', () => {
        throw new Error('private-sentinel-do-not-record');
      }),
    );
    journal.finish('failed');

    const failedRecords = readFileSync(stageFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(failedRecords[1].status, 'failed');
    assert.equal(failedRecords.at(-1).testStatus, 'failed');
    assert.equal(
      failedRecords.at(-1).failurePhase,
      'private-ui-dav-read-created',
    );
    assert.doesNotMatch(
      readFileSync(stageFile, 'utf8'),
      /private-sentinel-do-not-record/u,
    );

    const timeoutStage = join(directory, 'timeout.jsonl');
    const timeoutJournal = createPrivateUiCheckpointJournal({
      stageFile: timeoutStage,
      sourceSha,
      profile: 'normal-bot',
    });
    void timeoutJournal.run(
      'private-ui-dav-delete',
      () => new Promise(() => {}),
    );
    timeoutJournal.finish('timedOut');
    const timeoutRecords = readFileSync(timeoutStage, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(timeoutRecords[1].status, 'failed');
    assert.equal(timeoutRecords.at(-1).status, 'failed');
    assert.equal(timeoutRecords.at(-1).testStatus, 'timedOut');
    assert.equal(timeoutRecords.at(-1).failurePhase, 'private-ui-dav-delete');

    const finalizedReceipt = readFileSync(timeoutStage, 'utf8');
    let ordinaryOperationInvoked = false;
    await assert.rejects(
      timeoutJournal.run('private-ui-dav-cleanup', () => {
        ordinaryOperationInvoked = true;
      }),
      /Private acceptance checkpoints are complete/u,
    );
    assert.equal(ordinaryOperationInvoked, false);
    assert.equal(readFileSync(timeoutStage, 'utf8'), finalizedReceipt);

    let cleanupInvoked = false;
    const cleanupResult = await timeoutJournal.cleanup(
      'private-ui-dav-cleanup',
      () => {
        cleanupInvoked = true;
        throw new Error('private-cleanup-sentinel-do-not-record');
      },
    );
    assert.equal(cleanupInvoked, true);
    assert.equal(cleanupResult, undefined);
    assert.equal(readFileSync(timeoutStage, 'utf8'), finalizedReceipt);
    assert.doesNotMatch(
      readFileSync(timeoutStage, 'utf8'),
      /private-cleanup-sentinel-do-not-record/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('records only bounded calendar-list transport observations before finalization', () => {
  const { directory, stageFile } = createStageFile();
  try {
    const journal = createPrivateUiCheckpointJournal({
      stageFile,
      sourceSha,
      profile: 'normal-bot',
    });
    journal.recordCalendarListTransport([
      {
        endpoint: 'personal-list',
        method: 'OPTIONS',
        outcome: 'response',
        httpStatus: 204,
      },
      {
        endpoint: 'room-context',
        method: 'GET',
        outcome: 'network-failure',
        networkFailure: 'tls',
      },
      {
        endpoint: 'room-list',
        method: 'GET',
        outcome: 'pending',
      },
    ]);
    assert.throws(() => journal.recordCalendarListTransport([]), {
      message: 'Private acceptance checkpoint is invalid',
    });
    journal.finish('failed');

    const records = readFileSync(stageFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(records[0], {
      phase: 'private-ui-calendar-list-transport',
      status: 'observed',
      observations: [
        {
          endpoint: 'personal-list',
          method: 'OPTIONS',
          outcome: 'response',
          httpStatus: 204,
        },
        {
          endpoint: 'room-context',
          method: 'GET',
          outcome: 'network-failure',
          networkFailure: 'tls',
        },
        {
          endpoint: 'room-list',
          method: 'GET',
          outcome: 'pending',
        },
      ],
      sourceSha,
      profile: 'normal-bot',
    });
    assert.doesNotMatch(
      readFileSync(stageFile, 'utf8'),
      /https?:\/\/|token|password/u,
    );

    const immutableReceipt = readFileSync(stageFile, 'utf8');
    assert.throws(
      () => journal.recordCalendarListTransport([]),
      /Private acceptance checkpoints are complete/u,
    );
    assert.equal(readFileSync(stageFile, 'utf8'), immutableReceipt);

    const passedStageFile = join(directory, 'passed.jsonl');
    const passingJournal = createPrivateUiCheckpointJournal({
      stageFile: passedStageFile,
      sourceSha,
      profile: 'normal-bot',
    });
    passingJournal.recordCalendarListTransport([]);
    passingJournal.finish('passed');
    const passedRecords = readFileSync(passedStageFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(passedRecords.at(-1).status, 'passed');
    assert.equal(passedRecords.at(-1).testStatus, 'passed');
    assert.equal(passedRecords.at(-1).failurePhase, null);
    const passedReceipt = readFileSync(passedStageFile, 'utf8');
    assert.throws(
      () => passingJournal.recordCalendarListTransport([]),
      /Private acceptance checkpoints are complete/u,
    );
    assert.equal(readFileSync(passedStageFile, 'utf8'), passedReceipt);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects raw, duplicate, excessive, or invalid calendar-list observations', () => {
  const { directory, stageFile } = createStageFile();
  try {
    const journal = createPrivateUiCheckpointJournal({
      stageFile,
      sourceSha,
      profile: 'normal-bot',
    });
    const response = {
      endpoint: 'room-list',
      method: 'GET',
      outcome: 'response',
      httpStatus: 200,
    };
    const invalidObservations = [
      [{ ...response, requestUrl: 'https://private.invalid/path' }],
      [{ ...response, endpoint: 'private-sentinel-endpoint' }],
      [{ ...response, httpStatus: 999 }],
      [
        {
          endpoint: 'room-context',
          method: 'GET',
          outcome: 'network-failure',
          networkFailure: 'private-sentinel-error-text',
        },
      ],
      [response, response],
      Array.from({ length: 7 }, (_, index) => ({
        ...response,
        endpoint: ['personal-list', 'room-context', 'room-list'][index % 3],
        method: index < 3 ? 'GET' : 'OPTIONS',
      })),
    ];

    for (const observations of invalidObservations) {
      assert.throws(() => journal.recordCalendarListTransport(observations), {
        message: 'Private acceptance checkpoint is invalid',
      });
    }
    assert.throws(() => readFileSync(stageFile, 'utf8'), { code: 'ENOENT' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects unrecognized phase and profile values without echoing them', async () => {
  const { directory, stageFile } = createStageFile();
  try {
    assert.throws(
      () =>
        createPrivateUiCheckpointJournal({
          stageFile,
          sourceSha,
          profile: 'private-sentinel',
        }),
      (error) => {
        assert.equal(
          error.message,
          'Private acceptance checkpoints are unavailable',
        );
        return true;
      },
    );
    const journal = createPrivateUiCheckpointJournal({
      stageFile,
      sourceSha,
      profile: 'normal-bot',
    });
    await assert.rejects(
      journal.run('private-sentinel-phase', async () => true),
      (error) => {
        assert.equal(error.message, 'Private acceptance checkpoint is invalid');
        return true;
      },
    );
    assert.equal(statSync(directory).isDirectory(), true);
    assert.throws(() => readFileSync(stageFile, 'utf8'), { code: 'ENOENT' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
