import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  appendActionPhaseSummary,
  formatActionPhaseSummary,
  runActionPhaseSummary,
  summarizeActionPhaseOutcomes,
} from './element-acceptance-action-summary.mjs';

const ACTION_PHASES = [
  'web_member_outsider_journey',
  'desktop_journey',
  'desktop_journey_cleanup',
  'reminder_room',
  'reminder_enable',
  'reminder_initial',
  'reminder_restart',
  'reminder_restore',
  'web_client_interactions',
  'web_acceptance_summary',
  'desktop_journey_summary',
  'desktop_startup_summary',
  'acceptance_stack_cleanup',
];

function outcomesWithDefault(outcome = 'success') {
  return Object.fromEntries(ACTION_PHASES.map((phase) => [phase, outcome]));
}

function parseSummary(summaryLine) {
  const prefix = 'action_phase_summary=';
  assert.ok(summaryLine.startsWith(prefix));
  return JSON.parse(summaryLine.slice(prefix.length));
}

test('all completed phases pass and have no first failure', () => {
  const summary = summarizeActionPhaseOutcomes(outcomesWithDefault(), 1200);

  assert.deepEqual(summary, {
    phases: Object.fromEntries(ACTION_PHASES.map((phase) => [phase, 'passed'])),
    first_failed_phase: 'none',
    first_failed_category: 'none',
    web_member_outsider_journey: {
      status: 'passed',
      elapsed_seconds: 1.2,
    },
    first_failed_elapsed_seconds: null,
    report_complete: true,
  });
});

test('records a failed member and outsider journey with bounded timing metadata', () => {
  const outcomes = outcomesWithDefault();
  outcomes.web_member_outsider_journey = 'failure';
  outcomes.desktop_journey = 'skipped';
  outcomes.desktop_journey_cleanup = 'skipped';

  const summary = summarizeActionPhaseOutcomes(outcomes, 45_000);

  assert.equal(summary.web_member_outsider_journey.status, 'failed');
  assert.equal(summary.web_member_outsider_journey.elapsed_seconds, 45);
  assert.equal(summary.first_failed_phase, 'web_member_outsider_journey');
  assert.equal(summary.first_failed_category, 'web-journey-command');
  assert.equal(summary.first_failed_elapsed_seconds, 45);
  assert.equal(summary.report_complete, true);
});

test('keeps zero and sub-minute journey timings nonnegative and below 60 seconds', () => {
  for (const elapsedMilliseconds of [0, 59_999]) {
    const summary = summarizeActionPhaseOutcomes(
      outcomesWithDefault(),
      elapsedMilliseconds,
    );

    assert.ok(summary.web_member_outsider_journey.elapsed_seconds >= 0);
    assert.ok(summary.web_member_outsider_journey.elapsed_seconds < 60);
  }
});

test('an absent journey outcome or invalid timing is explicitly unknown', () => {
  const outcomes = outcomesWithDefault();
  outcomes.web_member_outsider_journey = undefined;
  const missingOutcome = summarizeActionPhaseOutcomes(outcomes, 1200);

  assert.equal(missingOutcome.web_member_outsider_journey.status, 'unknown');
  assert.equal(
    missingOutcome.web_member_outsider_journey.elapsed_seconds,
    null,
  );
  assert.equal(missingOutcome.first_failed_phase, 'unknown');
  assert.equal(missingOutcome.first_failed_category, 'unknown');
  assert.equal(missingOutcome.report_complete, false);

  const invalidTiming = summarizeActionPhaseOutcomes(
    outcomesWithDefault(),
    '-1',
  );
  assert.equal(invalidTiming.web_member_outsider_journey.status, 'passed');
  assert.equal(invalidTiming.web_member_outsider_journey.elapsed_seconds, null);
  assert.equal(invalidTiming.first_failed_phase, 'unknown');
  assert.equal(invalidTiming.report_complete, false);

  const skippedJourney = outcomesWithDefault();
  skippedJourney.web_member_outsider_journey = 'skipped';
  const skippedSummary = summarizeActionPhaseOutcomes(skippedJourney);
  assert.equal(skippedSummary.web_member_outsider_journey.status, 'skipped');
  assert.equal(skippedSummary.first_failed_phase, 'unknown');
  assert.equal(skippedSummary.first_failed_category, 'unknown');
  assert.equal(skippedSummary.report_complete, false);
});

test('keeps the first ordinary reminder failure ahead of skipped later phases', () => {
  const outcomes = outcomesWithDefault();
  outcomes.reminder_initial = 'failure';
  for (const phase of [
    'reminder_restart',
    'reminder_restore',
    'web_client_interactions',
  ]) {
    outcomes[phase] = 'skipped';
  }

  const summary = summarizeActionPhaseOutcomes(outcomes, 1200);
  assert.equal(summary.phases.reminder_initial, 'failed');
  assert.equal(summary.phases.reminder_restart, 'skipped');
  assert.equal(summary.first_failed_phase, 'reminder_initial');
  assert.equal(summary.report_complete, true);
});

test('records Desktop cleanup failure before the following conditionally skipped phases', () => {
  const outcomes = outcomesWithDefault();
  outcomes.desktop_journey_cleanup = 'failure';
  outcomes.reminder_room = 'skipped';
  outcomes.reminder_enable = 'skipped';
  outcomes.reminder_initial = 'skipped';

  const summary = summarizeActionPhaseOutcomes(outcomes, 1200);
  assert.equal(summary.phases.desktop_journey_cleanup, 'failed');
  assert.equal(summary.phases.reminder_room, 'skipped');
  assert.equal(summary.first_failed_phase, 'desktop_journey_cleanup');
});

test('a late stack cleanup failure does not replace an earlier phase failure', () => {
  const outcomes = outcomesWithDefault();
  outcomes.reminder_restore = 'failure';
  outcomes.acceptance_stack_cleanup = 'failure';

  const summary = summarizeActionPhaseOutcomes(outcomes, 1200);
  assert.equal(summary.phases.reminder_restore, 'failed');
  assert.equal(summary.phases.acceptance_stack_cleanup, 'failed');
  assert.equal(summary.first_failed_phase, 'reminder_restore');
});

test('conditional Desktop summary skips do not mask an earlier failure', () => {
  const outcomes = outcomesWithDefault();
  outcomes.web_client_interactions = 'failure';
  outcomes.desktop_journey_summary = 'skipped';
  outcomes.desktop_startup_summary = 'skipped';

  const summary = summarizeActionPhaseOutcomes(outcomes, 1200);
  assert.equal(summary.first_failed_phase, 'web_client_interactions');
  assert.equal(summary.phases.desktop_journey_summary, 'skipped');
  assert.equal(summary.phases.desktop_startup_summary, 'skipped');
});

test('missing, cancelled, and unrecognized outcomes are incomplete without exposing inputs', () => {
  const secretLike = 'secret-token-private-hostname';
  const outcomes = outcomesWithDefault();
  outcomes.reminder_room = undefined;
  outcomes.reminder_enable = 'cancelled';
  outcomes.reminder_initial = secretLike;
  outcomes.reminder_restore = 'failure';

  const summaryLine = formatActionPhaseSummary(outcomes, 1200);
  const summary = parseSummary(summaryLine);

  assert.equal(summary.phases.reminder_room, 'unknown');
  assert.equal(summary.phases.reminder_enable, 'unknown');
  assert.equal(summary.phases.reminder_initial, 'unknown');
  assert.equal(summary.phases.reminder_restore, 'failed');
  assert.equal(summary.first_failed_phase, 'unknown');
  assert.equal(summary.report_complete, false);
  assert.doesNotMatch(summaryLine, /secret-token|private-hostname|cancelled/u);
  assert.deepEqual(Object.keys(summary), [
    'phases',
    'first_failed_phase',
    'first_failed_category',
    'web_member_outsider_journey',
    'first_failed_elapsed_seconds',
    'report_complete',
  ]);
});

test('reads only the fixed action outcome environment keys', () => {
  let writtenSummary;
  const result = runActionPhaseSummary(
    'safe-summary.txt',
    {
      ELEMENT_ACCEPTANCE_PHASE_DESKTOP_JOURNEY: 'failure',
      ELEMENT_ACCEPTANCE_PHASE_WEB_MEMBER_OUTSIDER_JOURNEY: 'success',
      ELEMENT_ACCEPTANCE_WEB_MEMBER_OUTSIDER_JOURNEY_ELAPSED_MS: '59999',
      ELEMENT_ACCEPTANCE_PHASE_REMINDER_INITIAL: 'skipped',
      UNTRUSTED_ACTION_OUTPUT: 'secret-token private-hostname',
    },
    (_summaryPath, content) => {
      writtenSummary = content;
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.errorMessage, '');
  const summary = parseSummary(writtenSummary);
  assert.equal(summary.phases.desktop_journey, 'failed');
  assert.equal(summary.web_member_outsider_journey.elapsed_seconds, 59.999);
  assert.equal(summary.phases.reminder_initial, 'skipped');
  assert.equal(summary.phases.reminder_restart, 'unknown');
  assert.equal(summary.first_failed_phase, 'unknown');
  assert.equal(summary.report_complete, false);
  assert.doesNotMatch(
    writtenSummary,
    /UNTRUSTED|secret-token|private-hostname/u,
  );
});

test('appends only the bounded JSON report to the existing compact summary', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'element-action-summary-'));
  try {
    const summaryPath = resolve(directory, 'safe-summary.txt');
    const original = 'element-acceptance source_sha=0123456789abcdef\n';
    writeFileSync(summaryPath, original, { mode: 0o600 });

    const line = appendActionPhaseSummary(
      summaryPath,
      outcomesWithDefault(),
      undefined,
      1200,
    );

    assert.equal(readFileSync(summaryPath, 'utf8'), `${original}${line}`);
    assert.deepEqual(parseSummary(line).phases, outcomesWithDefault('passed'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('report-write failure leaves the prior summary unchanged and exposes only unavailable status', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'element-action-summary-'));
  try {
    const summaryPath = resolve(directory, 'safe-summary.txt');
    const original = 'element-acceptance source_sha=0123456789abcdef\n';
    writeFileSync(summaryPath, original, { mode: 0o600 });

    assert.throws(
      () =>
        appendActionPhaseSummary(
          summaryPath,
          outcomesWithDefault(),
          () => {
            throw new Error('secret-token private-hostname command-output');
          },
          1200,
        ),
      /secret-token/u,
    );
    assert.equal(readFileSync(summaryPath, 'utf8'), original);

    const environment = {
      ELEMENT_ACCEPTANCE_PHASE_REMINDER_INITIAL:
        'secret-token private-hostname',
    };
    const diagnosticFailure = runActionPhaseSummary(
      summaryPath,
      environment,
      () => {
        throw new Error('secret-token private-hostname command-output');
      },
    );
    assert.deepEqual(diagnosticFailure, {
      exitCode: 1,
      errorMessage: 'Action phase metadata unavailable.\n',
    });
    assert.doesNotMatch(
      diagnosticFailure.errorMessage,
      /secret-token|private-hostname|command-output/u,
    );
    assert.equal(readFileSync(summaryPath, 'utf8'), original);

    const filesystemFailure = runActionPhaseSummary(directory, environment);
    assert.deepEqual(filesystemFailure, diagnosticFailure);
    assert.equal(readFileSync(summaryPath, 'utf8'), original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
