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
          label={t('calendarEvents.editor.caldavAlarm', 'Calendar app alert')}
        />
        {values.alarmDisabledReason && (
          <Alert severity="info">
            {t(
              'calendarEvents.editor.unsupportedAlarmReadOnly',
              'This event has calendar app alert data this editor cannot safely change. Other event edits will preserve it.',
            )}
          </Alert>
        )}
        {values.alarmEnabled && values.alarmEditable !== false && (
          <Stack spacing={1}>
            <FormLabel component="legend">
              {t('calendarEvents.editor.alarmMode', 'Alert timing')}
            </FormLabel>
            <RadioGroup
              aria-label={t('calendarEvents.editor.alarmMode', 'Alert timing')}
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
                    'Calendar apps receive this alert at the exact time. A Matrix room notification cannot use it. To notify the room too, choose “Before the event”.',
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
                    'Saved with the event for calendar apps that support alerts. On its own, it does not notify anyone in the Matrix room.',
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
            <Typography variant="subtitle2">
              {t(
                'calendarEvents.editor.matrixReminderHeading',
                'Matrix room notifications',
              )}
            </Typography>
            <Typography variant="body2">
              {t(
                'calendarEvents.editor.matrixReminderSaveFirst',
                'Set these up after saving. Each one needs a saved calendar app alert on this event. For a timed event, a supported alert sets when the room is notified. For an all-day event, you choose a separate day, time and time zone. Then choose who to notify.',
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
                'Save and set up room notifications',
              )}
            </LoadingButton>
          </Stack>
        </Alert>
      )}
    </>
  );
}
