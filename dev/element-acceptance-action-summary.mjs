import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACTION_PHASES = Object.freeze([
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
]);

const OUTCOME_ENVIRONMENT_KEYS = Object.freeze({
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

const STATUS_BY_OUTCOME = Object.freeze({
  success: 'passed',
  failure: 'failed',
  skipped: 'skipped',
});

export function summarizeActionPhaseOutcomes(outcomes) {
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
        : 'started';

    if (status === 'started') reportComplete = false;
    phaseStatuses[phase] = status;
  }

  const firstFailedPhase = reportComplete
    ? (ACTION_PHASES.find((phase) => phaseStatuses[phase] === 'failed') ??
      'none')
    : 'unknown';

  return {
    phases: phaseStatuses,
    first_failed_phase: firstFailedPhase,
    report_complete: reportComplete,
  };
}

export function formatActionPhaseSummary(outcomes) {
  return `action_phase_summary=${JSON.stringify(summarizeActionPhaseOutcomes(outcomes))}\n`;
}

export function appendActionPhaseSummary(
  summaryPath,
  outcomes,
  append = appendFileSync,
) {
  if (typeof summaryPath !== 'string' || summaryPath.length === 0) {
    throw new Error('invalid-summary-path');
  }

  const summaryLine = formatActionPhaseSummary(outcomes);
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
