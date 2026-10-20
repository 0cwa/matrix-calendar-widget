import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTCOME_ENVIRONMENT_KEYS = Object.freeze({
  web_member_outsider_journey:
    'ELEMENT_ACCEPTANCE_PHASE_WEB_MEMBER_OUTSIDER_JOURNEY',
  desktop_journey: 'ELEMENT_ACCEPTANCE_PHASE_DESKTOP_JOURNEY',
  desktop_journey_cleanup: 'ELEMENT_ACCEPTANCE_PHASE_DESKTOP_JOURNEY_CLEANUP',
  reminder_room: 'ELEMENT_ACCEPTANCE_PHASE_REMINDER_ROOM',
  reminder_enable: 'ELEMENT_ACCEPTANCE_PHASE_REMINDER_ENABLE',
  reminder_initial: 'ELEMENT_ACCEPTANCE_PHASE_REMINDER_INITIAL',
  reminder_restart: 'ELEMENT_ACCEPTANCE_PHASE_REMINDER_RESTART',
  reminder_restore: 'ELEMENT_ACCEPTANCE_PHASE_REMINDER_RESTORE',
  web_client_interactions: 'ELEMENT_ACCEPTANCE_PHASE_WEB_CLIENT_INTERACTIONS',
  web_acceptance_summary: 'ELEMENT_ACCEPTANCE_PHASE_WEB_ACCEPTANCE_SUMMARY',
  desktop_journey_summary: 'ELEMENT_ACCEPTANCE_PHASE_DESKTOP_JOURNEY_SUMMARY',
  desktop_startup_summary: 'ELEMENT_ACCEPTANCE_PHASE_DESKTOP_STARTUP_SUMMARY',
  acceptance_stack_cleanup: 'ELEMENT_ACCEPTANCE_PHASE_ACCEPTANCE_STACK_CLEANUP',
});

const ACTION_PHASES = Object.freeze(Object.keys(OUTCOME_ENVIRONMENT_KEYS));

const STATUS_BY_OUTCOME = Object.freeze({
  success: 'passed',
  failure: 'failed',
  skipped: 'skipped',
});

const WEB_JOURNEY_ELAPSED_ENVIRONMENT_KEY =
  'ELEMENT_ACCEPTANCE_WEB_MEMBER_OUTSIDER_JOURNEY_ELAPSED_MS';

function parseElapsedSeconds(value) {
  if (typeof value !== 'string' || !/^\d{1,12}$/u.test(value)) return null;

  const elapsedMilliseconds = Number(value);
  if (!Number.isSafeInteger(elapsedMilliseconds)) return null;
  return Number((elapsedMilliseconds / 1000).toFixed(3));
}

export function summarizeActionPhaseOutcomes(outcomes, elapsedMilliseconds) {
  const phaseStatuses = {};
  let reportComplete = true;

  for (const phase of ACTION_PHASES) {
    const outcome =
      outcomes !== null &&
      typeof outcomes === 'object' &&
      Object.hasOwn(outcomes, phase)
        ? outcomes[phase]
        : undefined;
    const status =
      typeof outcome === 'string' && Object.hasOwn(STATUS_BY_OUTCOME, outcome)
        ? STATUS_BY_OUTCOME[outcome]
        : 'unknown';

    if (status === 'unknown') reportComplete = false;
    phaseStatuses[phase] = status;
  }

  const journeyOutcome = phaseStatuses.web_member_outsider_journey;
  const journeyElapsedSeconds =
    journeyOutcome === 'passed' || journeyOutcome === 'failed'
      ? parseElapsedSeconds(String(elapsedMilliseconds))
      : null;
  if (
    (journeyOutcome === 'passed' || journeyOutcome === 'failed') &&
    journeyElapsedSeconds === null
  ) {
    reportComplete = false;
  }
  if (journeyOutcome === 'skipped') reportComplete = false;

  const firstFailedPhase = reportComplete
    ? (ACTION_PHASES.find((phase) => phaseStatuses[phase] === 'failed') ??
      'none')
    : 'unknown';
  const firstFailedCategory =
    firstFailedPhase === 'web_member_outsider_journey'
      ? 'web-journey-command'
      : firstFailedPhase === 'none'
        ? 'none'
        : firstFailedPhase === 'unknown'
          ? 'unknown'
          : 'workflow-step';

  return {
    phases: phaseStatuses,
    first_failed_phase: firstFailedPhase,
    first_failed_category: firstFailedCategory,
    web_member_outsider_journey: {
      status: journeyOutcome,
      elapsed_seconds: journeyElapsedSeconds,
    },
    first_failed_elapsed_seconds:
      firstFailedPhase === 'web_member_outsider_journey'
        ? journeyElapsedSeconds
        : null,
    report_complete: reportComplete,
  };
}

export function formatActionPhaseSummary(outcomes, elapsedMilliseconds) {
  return `action_phase_summary=${JSON.stringify(summarizeActionPhaseOutcomes(outcomes, elapsedMilliseconds))}\n`;
}

export function appendActionPhaseSummary(
  summaryPath,
  outcomes,
  append = appendFileSync,
  elapsedMilliseconds,
) {
  if (typeof summaryPath !== 'string' || summaryPath.length === 0) {
    throw new Error('invalid-summary-path');
  }

  const summaryLine = formatActionPhaseSummary(outcomes, elapsedMilliseconds);
  append(summaryPath, summaryLine, { encoding: 'utf8', mode: 0o600 });
  return summaryLine;
}

function readActionPhaseOutcomes(environment) {
  return Object.fromEntries(
    ACTION_PHASES.map((phase) => [
      phase,
      environment[OUTCOME_ENVIRONMENT_KEYS[phase]],
    ]),
  );
}

function readWebJourneyElapsedMilliseconds(environment) {
  return environment[WEB_JOURNEY_ELAPSED_ENVIRONMENT_KEY];
}

export function runActionPhaseSummary(
  summaryPath,
  environment,
  append = appendFileSync,
) {
  try {
    appendActionPhaseSummary(
      summaryPath,
      readActionPhaseOutcomes(environment),
      append,
      readWebJourneyElapsedMilliseconds(environment),
    );
    return { exitCode: 0, errorMessage: '' };
  } catch {
    return {
      exitCode: 1,
      errorMessage: 'Action phase metadata unavailable.\n',
    };
  }
}

function main() {
  const result = runActionPhaseSummary(process.argv[2], process.env);
  if (result.errorMessage) process.stderr.write(result.errorMessage);
  process.exitCode = result.exitCode;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
