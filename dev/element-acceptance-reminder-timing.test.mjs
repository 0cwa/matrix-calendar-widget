import assert from 'node:assert/strict';
import test from 'node:test';
import { reminderFixtureAllDayExpectedScheduleMatches } from './element-acceptance-reminder-timing.mjs';

const expectedDueAt = Date.UTC(2026, 9, 24, 12, 30);

test('skips absent all-day schedule fields for timed marker readback', () => {
  assert.equal(
    reminderFixtureAllDayExpectedScheduleMatches({
      allDay: false,
      expectedDueAt,
      eventStartDate: undefined,
      daysBefore: 0,
      localTime: '',
      timeZone: '',
    }),
    true,
  );
});

test('matches an all-day schedule against its exact due date, offset, and local time', () => {
  const schedule = {
    allDay: true,
    expectedDueAt,
    eventStartDate: '2026-10-25',
    daysBefore: 1,
    localTime: '14:30',
    timeZone: 'Europe/Stockholm',
  };
  assert.equal(reminderFixtureAllDayExpectedScheduleMatches(schedule), true);
  assert.equal(
    reminderFixtureAllDayExpectedScheduleMatches({
      ...schedule,
      daysBefore: 0,
    }),
    false,
  );
  assert.equal(
    reminderFixtureAllDayExpectedScheduleMatches({
      ...schedule,
      localTime: '14:31',
    }),
    false,
  );
});

test('fails closed for an invalid all-day schedule timezone', () => {
  assert.equal(
    reminderFixtureAllDayExpectedScheduleMatches({
      allDay: true,
      expectedDueAt,
      eventStartDate: '2026-10-25',
      daysBefore: 1,
      localTime: '14:30',
      timeZone: 'Invalid/Timezone',
    }),
    false,
  );
});
