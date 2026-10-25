import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sanitizeElementAcceptance } from './sanitize-element-acceptance.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const ALARM_PHASE = 'reminder-alarm-ui-readback';

function serializeStageRecord(phase, status, httpStatus, count, extra) {
  return JSON.stringify({
    phase,
    status,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(count === undefined ? {} : { count }),
    ...extra,
  });
}

test('records one detailed alarm failure and rejects the old outer fallback row', () => {
  const producerSource = readFileSync(
    new URL('../e2e/src/elementCalendarAcceptance.spec.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    producerSource,
    /JSON\.stringify\(\{\s*phase,\s*status,\s*\.\.\.\(httpStatus === undefined \? \{\} : \{ httpStatus \}\),\s*\.\.\.\(count === undefined \? \{\} : \{ count \}\),\s*\.\.\.extra,\s*\}\)/u,
  );
  assert.match(
    producerSource,
    /if\s*\(!alarmReadback\)\s*\{\s*record\(\s*activePhase,\s*'failed',\s*alarmObservation\.alarmUiPatchStatus \|\| undefined,\s*1,\s*\{\s*\.\.\.alarmObservation,\s*relativeAlarmReadback: false,\s*\},\s*\);\s*activeReminderFailureRecorded = true;\s*throw new Error\('The relative alarm did not reload from the event'\);/u,
  );
  assert.match(
    producerSource,
    /if\s*\(!failureAlreadyRecorded && !activeReminderFailureRecorded\)\s*\{\s*record\(activePhase, 'failed', failureHttpStatus\);/u,
  );

  const alarmObservation = {
    alarmUiStep: 'readback-alarm-toggle',
    alarmUiPatchStatus: 200,
    alarmUiRelativeAlarmReadback: false,
    alarmUiAlarmToggleReadback: false,
    alarmUiRelativeTriggerReadback: false,
    alarmUiOffsetReadback: false,
    alarmUiEditorClosed: false,
    alarmUiDetailsClosed: false,
    relativeAlarmReadback: false,
  };
  const detailedFailure = serializeStageRecord(
    ALARM_PHASE,
    'failed',
    200,
    1,
    alarmObservation,
  );
  assert.match(
    sanitizeElementAcceptance(detailedFailure, SOURCE_SHA),
    /phase=reminder-alarm-ui-readback status=failed count=1 http_status=200 alarm_ui_step=readback-alarm-toggle/u,
  );

  const oldOuterFallback = serializeStageRecord(
    ALARM_PHASE,
    'failed',
    200,
    undefined,
    undefined,
  );
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        [detailedFailure, oldOuterFallback].join('\n'),
        SOURCE_SHA,
      ),
    { message: 'invalid element acceptance summary' },
  );
});

test('reminder producer uses planned timed values and the computed UI alarm lead', () => {
  const producerSource = readFileSync(
    new URL('../e2e/src/elementCalendarAcceptance.spec.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    producerSource,
    /planReminderTimedEvent\(fixtureNow, REMINDER_TIMED_TIMEZONE\)/u,
  );
  assert.match(
    producerSource,
    /addCalDavAlarmFromReminderSettings\(\s*frame,\s*page,\s*title,\s*alarmLeadMinutes,/u,
  );
  assert.match(
    producerSource,
    /getByRole\('spinbutton', \{ name: 'Minutes before' \}\)\s*\.fill\(String\(leadMinutes\)\)/u,
  );
  assert.match(
    producerSource,
    /expectedDueAt: markerPlan\.allDay \? undefined : dueAt/u,
  );
  assert.doesNotMatch(
    producerSource,
    /getByRole\('spinbutton', \{ name: 'Minutes before' \}\)\s*\.fill\('1'\)/u,
  );
});
