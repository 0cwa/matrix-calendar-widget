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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEventEditorModel } from './useCalendarEventEditor';

const durationFields = [
  'alarmWeeks',
  'alarmDays',
  'alarmHours',
  'alarmMinutes',
  'alarmSeconds',
] as const;
type DurationField = (typeof durationFields)[number];

const alarmPresets = [
  { id: '15m', field: 'alarmMinutes', amount: '15' },
  { id: '1h', field: 'alarmHours', amount: '1' },
  { id: '1d', field: 'alarmDays', amount: '1' },
] as const;

export function CalendarEventAlarmFields({
  model,
}: {
  model: CalendarEventEditorModel;
}) {
  const {
    t,
    values,
    setValues,
    open,
    event,
    viewerTimezone,
    validationErrorCode,
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
  const { i18n } = useTranslation();
  const durationLabels = {
    alarmWeeks: t('calendarEvents.editor.alarmWeeks', 'Weeks before'),
    alarmDays: t('calendarEvents.editor.alarmDays', 'Days before'),
    alarmHours: t('calendarEvents.editor.alarmHours', 'Hours before'),
    alarmMinutes: t('calendarEvents.editor.alarmMinutes', 'Minutes before'),
    alarmSeconds: t('calendarEvents.editor.alarmSeconds', 'Seconds before'),
  };

  const [customSelection, setCustomSelection] = useState<{
    unit: DurationField;
    multi: boolean;
  }>();

  useEffect(() => setCustomSelection(undefined), [open, event]);

  if (!values) return null;

  const matched = alarmPresets.find(({ field, amount }) =>
    durationFields.every(
      (key) =>
        Number(values[key] || 0) === (key === field ? Number(amount) : 0),
    ),
  );
  const populatedUnits = durationFields.filter(
    (field) => Number(values[field]) > 0,
  );
  const { unit, multi } = customSelection ?? {
    unit: populatedUnits[0] ?? 'alarmMinutes',
    multi: populatedUnits.length > 1,
  };
  const custom = Boolean(customSelection) || !matched;

  const updateSingle = (field: DurationField, amount: string) =>
    setValues((current) =>
      current
        ? {
            ...current,
            ...Object.fromEntries(
              durationFields.map((key) => [key, key === field ? amount : '0']),
            ),
            alarmChanged: true,
          }
        : current,
    );
  const utc = values.alarmUtcDateTime ?? '';
  const validUtc =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(utc) &&
    DateTime.fromISO(utc, { zone: 'utc' }).isValid;
  const local = validUtc
    ? DateTime.fromISO(utc, { zone: 'utc' })
        .setZone(viewerTimezone)
        .setLocale(i18n.language)
    : undefined;
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
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ step: 1 }}
                  error={validationErrorCode === 'invalid-alarm-utc'}
                  helperText={t(
                    'calendarEvents.editor.alarmUtcDateTimeHelp',
                    'Entered in UTC. Calendar apps receive this alert at the exact instant.',
                  )}
                  label={t(
                    'calendarEvents.editor.alarmUtcDateTime',
                    'Exact time (UTC)',
                  )}
                  type={!utc || validUtc ? 'datetime-local' : 'text'}
                  value={validUtc ? utc.slice(0, -1) : utc}
                  onChange={(e) => {
                    const value = e.target.value;
                    const normalized =
                      !utc || validUtc
                        ? value
                          ? `${value}${value.length === 16 ? ':00' : ''}Z`
                          : ''
                        : value;
                    setValues((current) =>
                      current
                        ? {
                            ...current,
                            alarmUtcDateTime: normalized,
                            alarmChanged: true,
                          }
                        : current,
                    );
                  }}
                />
                {local?.isValid && viewerTimezone !== 'UTC' && (
                  <Typography color="text.secondary" variant="body2">
                    {t(
                      'calendarEvents.editor.viewerTime',
                      'Your time ({{timezone}}): {{time}}',
                      {
                        timezone: viewerTimezone,
                        time: local.toLocaleString(
                          DateTime.DATETIME_MED_WITH_SECONDS,
                        ),
                      },
                    )}
                  </Typography>
                )}
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
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  aria-label={t(
                    'calendarEvents.editor.alarmLeadTime',
                    'Time before the event starts',
                  )}
                  value={custom ? 'custom' : matched?.id}
                  onChange={(_, choice: string | null) => {
                    if (choice === 'custom') {
                      setCustomSelection({ unit, multi });
                      return;
                    }
                    const preset = alarmPresets.find(({ id }) => id === choice);
                    if (preset) {
                      setCustomSelection(undefined);
                      updateSingle(preset.field, preset.amount);
                    }
                  }}
                  sx={{ flexWrap: 'wrap' }}
                >
                  <ToggleButton value="15m">
                    {t('calendarEvents.editor.alarmPreset15', '15 min')}
                  </ToggleButton>
                  <ToggleButton value="1h">
                    {t('calendarEvents.editor.alarmPresetHour', '1 hour')}
                  </ToggleButton>
                  <ToggleButton value="1d">
                    {t('calendarEvents.editor.alarmPresetDay', '1 day')}
                  </ToggleButton>
                  <ToggleButton value="custom">
                    {t('calendarEvents.editor.alarmPresetCustom', 'Custom')}
                  </ToggleButton>
                </ToggleButtonGroup>
                {custom &&
                  (multi ? (
                    <>
                      <Typography color="text.secondary" variant="body2">
                        {t(
                          'calendarEvents.editor.alarmMultiUnit',
                          'This alert uses multiple duration units from the saved event.',
                        )}
                      </Typography>
                      <Stack
                        display="grid"
                        gap={1}
                        gridTemplateColumns="repeat(auto-fit, minmax(110px, 1fr))"
                      >
                        {durationFields.map((field) => (
                          <TextField
                            key={field}
                            inputProps={{ min: 0, step: 1 }}
                            label={durationLabels[field]}
                            onChange={(event) => {
                              setCustomSelection({ unit, multi: true });
                              handleAlarmDurationChange(field)(event);
                            }}
                            type="number"
                            value={values[field] ?? '0'}
                          />
                        ))}
                      </Stack>
                    </>
                  ) : (
                    <Stack direction="row" spacing={1}>
                      <TextField
                        label={t(
                          'calendarEvents.editor.alarmCustomValue',
                          'Lead time',
                        )}
                        type="number"
                        inputProps={{ min: 1, step: 1 }}
                        value={values[unit] ?? '0'}
                        onChange={(event) => {
                          setCustomSelection({ unit, multi: false });
                          updateSingle(unit, event.target.value);
                        }}
                        sx={{ flex: '1 1 6rem' }}
                      />
                      <TextField
                        select
                        SelectProps={{ native: true }}
                        label={t(
                          'calendarEvents.editor.alarmCustomUnit',
                          'Unit',
                        )}
                        value={unit}
                        onChange={(event) => {
                          const nextUnit = durationFields.find(
                            (field) => field === event.target.value,
                          );
                          if (nextUnit) {
                            setCustomSelection({
                              unit: nextUnit,
                              multi: false,
                            });
                            updateSingle(nextUnit, values[unit] ?? '');
                          }
                        }}
                        sx={{ flex: '1 1 8rem' }}
                      >
                        {durationFields.map((field) => (
                          <option key={field} value={field}>
                            {t(
                              `calendarEvents.editor.duration${field.slice(5)}`,
                              field.slice(5),
                            )}
                          </option>
                        ))}
                      </TextField>
                    </Stack>
                  ))}
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
