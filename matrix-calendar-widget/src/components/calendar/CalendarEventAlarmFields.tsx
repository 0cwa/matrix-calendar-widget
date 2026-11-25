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

import { LoadingButton } from '@mui/lab';
import {
  Alert,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { CalendarEventEditorModel } from './useCalendarEventEditor';

export function CalendarEventAlarmFields({
  model,
}: {
  model: CalendarEventEditorModel;
}) {
  const {
    t,
    values,
    saving,
    savingRoomReminderSetup,
    missingOccurrence,
    readOnly,
    chooseScope,
    editingOccurrence,
    occurrenceHasChanges,
    followingTimingUnchanged,
    handleAlarmToggle,
    handleAlarmDurationChange,
    handleAlarmModeChange,
    validationError,
    onSaveAndConfigureRoomReminders,
    submit,
  } = model;
  if (!values) return null;
  return (
    <>
      <FormControl component="fieldset">
        <FormControlLabel
          control={
            <Switch
              checked={Boolean(values.alarmEnabled)}
              disabled={values.alarmEditable === false}
              onChange={handleAlarmToggle}
            />
          }
          label={t('calendarEvents.editor.caldavAlarm', 'CalDAV reminder')}
        />
        {values.alarmDisabledReason && (
          <Alert severity="info">
            {t(
              'calendarEvents.editor.unsupportedAlarmReadOnly',
              'This event contains alarm data this editor cannot safely change. Other event edits will preserve it.',
            )}
          </Alert>
        )}
        {values.alarmEnabled && values.alarmEditable !== false && (
          <Stack spacing={1}>
            <FormLabel component="legend">
              {t('calendarEvents.editor.alarmMode', 'Alarm timing')}
            </FormLabel>
            <RadioGroup
              aria-label={t('calendarEvents.editor.alarmMode', 'Alarm timing')}
              onChange={handleAlarmModeChange}
              row
              value={values.alarmMode ?? 'relative'}
            >
              <FormControlLabel
                control={<Radio />}
                label={t(
                  'calendarEvents.editor.alarmRelativeMode',
                  'Before the event',
                )}
                value="relative"
              />
              <FormControlLabel
                control={<Radio />}
                label={t(
                  'calendarEvents.editor.alarmAbsoluteMode',
                  'At an exact UTC time',
                )}
                value="absolute"
              />
            </RadioGroup>
            {values.alarmMode === 'absolute' ? (
              <Stack spacing={1}>
                <TextField
                  fullWidth
                  helperText={t(
                    'calendarEvents.editor.alarmUtcDateTimeHelp',
                    'Enter YYYY-MM-DDTHH:mm:ssZ in UTC.',
                  )}
                  label={t(
                    'calendarEvents.editor.alarmUtcDateTime',
                    'Exact time (UTC)',
                  )}
                  onChange={handleAlarmDurationChange('alarmUtcDateTime')}
                  placeholder="2026-10-01T08:45:00Z"
                  value={values.alarmUtcDateTime ?? ''}
                />
                <Typography color="text.secondary" variant="body2">
                  {t(
                    'calendarEvents.editor.absoluteAlarmBoundary',
                    'This absolute alarm is saved to the calendar and cannot be delivered as a Matrix room reminder.',
                  )}
                </Typography>
              </Stack>
            ) : (
              <Stack spacing={1}>
                <FormLabel component="legend">
                  {t(
                    'calendarEvents.editor.alarmLeadTime',
                    'Time before the event starts',
                  )}
                </FormLabel>
                <Stack direction={{ sm: 'row', xs: 'column' }} spacing={1}>
                  {(
                    [
                      ['alarmWeeks', 'alarmWeeks', 'Weeks before'],
                      ['alarmDays', 'alarmDays', 'Days before'],
                      ['alarmHours', 'alarmHours', 'Hours before'],
                      ['alarmMinutes', 'alarmMinutes', 'Minutes before'],
                      ['alarmSeconds', 'alarmSeconds', 'Seconds before'],
                    ] as const
                  ).map(([field, key, fallback]) => (
                    <TextField
                      inputProps={{ min: 0, step: 1 }}
                      key={field}
                      label={t(`calendarEvents.editor.${key}`, fallback)}
                      onChange={handleAlarmDurationChange(field)}
                      type="number"
                      value={values[field] ?? '0'}
                    />
                  ))}
                </Stack>
                <Typography color="text.secondary" variant="body2">
                  {t(
                    'calendarEvents.editor.alarmBoundary',
                    'This stores a CalDAV display alarm for clients that support it. Matrix reminder delivery is separate.',
                  )}
                </Typography>
              </Stack>
            )}
          </Stack>
        )}
      </FormControl>

      {onSaveAndConfigureRoomReminders && (
        <Alert severity="info">
          <Stack spacing={1}>
            <Typography variant="body2">
              {t(
                'calendarEvents.editor.matrixReminderSaveFirst',
                'Save this event first. Supported timed Matrix reminders follow the saved CalDAV alert; all-day events need a separate local time and time zone. Choose who Matrix should ping after the save.',
              )}
            </Typography>
            <LoadingButton
              disabled={
                saving ||
                Boolean(validationError) ||
                readOnly ||
                chooseScope ||
                missingOccurrence ||
                followingTimingUnchanged ||
                (editingOccurrence && !occurrenceHasChanges)
              }
              loading={savingRoomReminderSetup}
              onClick={(clickEvent) => {
                const form = clickEvent.currentTarget.form;

                if (form?.reportValidity()) {
                  void submit({
                    kind: 'save-and-configure-room-reminders',
                  });
                }
              }}
              size="small"
              type="button"
              variant="outlined"
            >
              {t(
                'calendarEvents.editor.saveAndConfigureMatrixReminders',
                'Save and configure Matrix reminders',
              )}
            </LoadingButton>
          </Stack>
        </Alert>
      )}
    </>
  );
}
