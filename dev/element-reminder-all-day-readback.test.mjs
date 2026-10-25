import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readReminderAllDayScheduleFields } from './element-reminder-all-day-readback.mjs';

test('timed reminders never query all-day schedule controls', async () => {
  const selectorCalls = [];
  const inputValueCalls = [];
  const details = {
    getByRole(role, options) {
      selectorCalls.push({ role, name: options.name });
      return {
        async inputValue() {
          inputValueCalls.push(options.name);
          throw new Error('Timed reminder has no all-day schedule controls');
        },
      };
    },
    getByLabel(label) {
      selectorCalls.push({ label });
      return {
        async inputValue() {
          inputValueCalls.push(label);
          throw new Error('Timed reminder has no all-day schedule controls');
        },
      };
    },
  };

  const actual = await readReminderAllDayScheduleFields(details, false);

  assert.deepEqual(actual, { daysBefore: 0, localTime: '', timezone: '' });
  assert.deepEqual(selectorCalls, []);
  assert.deepEqual(inputValueCalls, []);
});

test('all-day reminders read and return every schedule field', async () => {
  const selectorCalls = [];
  const values = new Map([
    ['Days before event', '2'],
    ['Local time', '08:45'],
    ['Time zone (IANA)', 'Asia/Tokyo'],
  ]);
  const details = {
    getByRole(role, options) {
      selectorCalls.push({ role, name: options.name });
      return { inputValue: async () => values.get(options.name) };
    },
    getByLabel(label) {
      selectorCalls.push({ label });
      return { inputValue: async () => values.get(label) };
    },
  };

  const actual = await readReminderAllDayScheduleFields(details, true);

  assert.deepEqual(actual, {
    daysBefore: 2,
    localTime: '08:45',
    timezone: 'Asia/Tokyo',
  });
  assert.deepEqual(selectorCalls, [
    { role: 'spinbutton', name: 'Days before event' },
    { label: 'Local time' },
    { role: 'textbox', name: 'Time zone (IANA)' },
  ]);
});
