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

import type { CalendarEventWeekday } from '@matrix-calendar-widget/calendar';
import {
  Calendar,
  CalendarEvent,
  CalendarEventInput,
  CalendarRepositoryError,
} from '@matrix-calendar-widget/calendar';
import { LoadingButton } from '@mui/lab';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarEventFormValues,
  calendarEventFormStartWeekday,
  calendarEventInputFromForm,
  calendarEventPatchFromForm,
  calendarEventToFormValues,
  createCalendarEventFormValues,
  useCalendarRepository,
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
  validateCalendarEventForm,
} from '../../calendar';

const WEEKDAYS: CalendarEventWeekday[] = [
  'MO',
  'TU',
  'WE',
  'TH',
  'FR',
  'SA',
  'SU',
];

export function CalendarEventEditorDialog({
  calendars,
  event,
  onClose,
  onSaved,
  open,
  uidFactory = createEventUid,
}: {
  calendars: Calendar[];
  event?: CalendarEvent;
  onClose: () => void;
  onSaved?: (event: CalendarEvent) => void;
  open: boolean;
  uidFactory?: () => string;
}) {
  const { t } = useTranslation();
  const writableCalendars = useMemo(
    () => calendars.filter((calendar) => !calendar.readOnly),
    [calendars],
  );
  const initialCalendar =
    calendars.find((calendar) => calendar.id === event?.calendarId) ??
    writableCalendars[0] ??
    calendars[0];
  const [values, setValues] = useState<CalendarEventFormValues | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error>();
  const [conflict, setConflict] = useState(false);
  const repository = useCalendarRepository();
  const createEvent = useCreateCalendarEvent();
  const updateEvent = useUpdateCalendarEvent();

  useEffect(() => {
    if (!open || !initialCalendar) {
      return;
    }

    setValues(
      event
        ? calendarEventToFormValues(event, initialCalendar)
        : createCalendarEventFormValues(initialCalendar),
    );
    setError(undefined);
    setConflict(false);
  }, [event, initialCalendar, open]);

  if (!values || !initialCalendar) {
    return null;
  }

  const selectedCalendar =
    calendars.find((calendar) => calendar.id === values.calendarId) ??
    initialCalendar;
  const readOnly = Boolean(selectedCalendar.readOnly);
  const originalTimedTiming =
    values.originalTiming?.type === 'timed' ? values.originalTiming : undefined;
  const hasFloatingEndpoint =
    values.timedKind === 'floating' ||
    originalTimedTiming?.start.type === 'floating' ||
    originalTimedTiming?.end.type === 'floating';
  const timingHelpText = hasFloatingEndpoint
    ? values.timedKind === 'mixed'
      ? t(
          'calendarEvents.editor.mixedFloatingTime',
          'Floating endpoints use your local time zone; zoned endpoints keep their saved time zone.',
        )
      : t(
          'calendarEvents.editor.floatingTime',
          'Floating time (shown in your local time zone)',
        )
    : values.timedKind === 'mixed'
      ? t(
          'calendarEvents.editor.mixedTimezoneTime',
          'Each endpoint keeps its saved time zone.',
        )
      : undefined;

  const handleChange =
    (field: keyof CalendarEventFormValues) =>
    (change: ChangeEvent<HTMLInputElement>) => {
      setValues((current) =>
        current
          ? {
              ...current,
              [field]: change.target.value,
              ...(field === 'start' || field === 'end' || field === 'timezone'
                ? { timingChanged: true }
                : {}),
              ...(field === 'timezone' ? { timezoneChanged: true } : {}),
              ...(field.startsWith('recurrence')
                ? { recurrenceChanged: true }
                : {}),
            }
          : current,
      );
    };

  const handleCalendarChange = (change: ChangeEvent<HTMLInputElement>) => {
    const calendarId = change.target.value;
    const calendar = calendars.find((candidate) => candidate.id === calendarId);

    setValues((current) =>
      current
        ? {
            ...current,
            calendarId,
            timezone: calendar?.timezone ?? current.timezone,
            timingChanged: true,
            timezoneChanged: true,
          }
        : current,
    );
  };

  const handleRecurrenceToggle = (change: ChangeEvent<HTMLInputElement>) => {
    setValues((current) =>
      current
        ? {
            ...current,
            repeats: change.target.checked,
            recurrenceChanged: true,
          }
        : current,
    );
  };

  const handleWeekdayModeChange = (change: ChangeEvent<HTMLInputElement>) => {
    setValues((current) =>
      current
        ? {
            ...current,
            recurrenceWeekdays: change.target.checked
              ? [calendarEventFormStartWeekday(current)]
              : undefined,
            recurrenceChanged: true,
          }
        : current,
    );
  };

  const handleWeekdayChange = (weekday: CalendarEventWeekday) => {
    setValues((current) => {
      if (!current) {
        return current;
      }

      const requiredWeekday = calendarEventFormStartWeekday(current);
      const selected = new Set(current.recurrenceWeekdays ?? [requiredWeekday]);
      selected.add(requiredWeekday);
      if (selected.has(weekday)) {
        selected.delete(weekday);
      } else {
        selected.add(weekday);
      }
      selected.add(requiredWeekday);
      const nextWeekdays = WEEKDAYS.filter((day) => selected.has(day));

      return {
        ...current,
        recurrenceWeekdays:
          nextWeekdays.length === 1 ? undefined : nextWeekdays,
        recurrenceChanged: true,
      };
    });
  };

  const handleTimingTypeChange = (change: ChangeEvent<HTMLInputElement>) => {
    const timingType = change.target.checked ? 'all-day' : 'timed';

    setValues((current) => {
      if (!current || current.timingType === timingType) {
        return current;
      }

      if (timingType === 'all-day') {
        return {
          ...current,
          timingType,
          start: current.start.slice(0, 10),
          end: current.end.slice(0, 10),
          timingChanged: true,
        };
      }

      return {
        ...current,
        timingType,
        start: `${current.start}T09:00`,
        end: `${current.end}T10:00`,
        timingChanged: true,
      };
    });
  };

  const validationErrorCode = validateCalendarEventForm(values);
  const weeklyByDayEnabled =
    values.recurrenceFrequency === 'WEEKLY' &&
    values.recurrenceWeekdays !== undefined;
  const canChooseWeekdays =
    values.recurrenceInterval === '1' && values.recurrenceEnd === 'never';
  const validationError =
    validationErrorCode === 'title-required'
      ? t('calendarEvents.editor.titleRequired', 'A title is required.')
      : validationErrorCode === 'invalid-timezone'
        ? t(
            'calendarEvents.editor.invalidTimezone',
            'Enter a valid IANA time zone.',
          )
        : validationErrorCode === 'invalid-range'
          ? t(
              'calendarEvents.editor.invalidRange',
              values.timingType === 'all-day'
                ? 'The end must be on or after the start.'
                : 'The end must be after the start.',
            )
          : validationErrorCode === 'invalid-recurrence'
            ? t(
                'calendarEvents.editor.invalidRecurrence',
                'Check the recurrence frequency, interval, and end date or count.',
              )
            : undefined;

  const handleSubmit = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();

    if (validationError || readOnly) {
      return;
    }

    setSaving(true);
    setError(undefined);
    setConflict(false);

    try {
      let saved: CalendarEvent;

      if (event) {
        saved = await updateEvent(
          event.calendarId,
          event.id,
          calendarEventPatchFromForm(values),
        );
      } else {
        const input: CalendarEventInput = calendarEventInputFromForm(
          values,
          uidFactory(),
        );
        saved = await createEvent(values.calendarId, input);
      }

      onSaved?.(saved);
      onClose();
    } catch (caught) {
      if (
        event &&
        caught instanceof CalendarRepositoryError &&
        caught.code === 'event-conflict'
      ) {
        setConflict(true);
        setError(
          new Error(
            t(
              'calendarEvents.editor.conflict',
              'This event changed elsewhere. Reload the latest version before retrying.',
            ),
          ),
        );
      } else {
        setError(
          new Error(
            t(
              'calendarEvents.editor.saveError',
              'The event could not be saved.',
            ),
          ),
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReloadLatest = async () => {
    if (!event) {
      return;
    }

    setSaving(true);
    try {
      const latest = await repository.getEvent(event.calendarId, event.id);
      const latestCalendar =
        calendars.find((calendar) => calendar.id === latest.calendarId) ??
        initialCalendar;
      setValues(calendarEventToFormValues(latest, latestCalendar));
      setConflict(false);
      setError(undefined);
      onSaved?.(latest);
    } catch {
      setError(
        new Error(
          t(
            'calendarEvents.editor.reloadError',
            'The latest event could not be loaded.',
          ),
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      fullWidth
      maxWidth="sm"
      onClose={saving ? undefined : onClose}
      open={open}
    >
      <form onSubmit={handleSubmit}>
        <DialogTitle>
          {event
            ? t('calendarEvents.editor.editTitle', 'Edit event')
            : t('calendarEvents.editor.createTitle', 'Create event')}
        </DialogTitle>

        <DialogContent>
          <Stack mt={1} spacing={2}>
            {error && (
              <Alert
                action={
                  conflict ? (
                    <Button
                      color="inherit"
                      disabled={saving}
                      onClick={handleReloadLatest}
                      size="small"
                    >
                      {t('calendarEvents.editor.reloadLatest', 'Reload latest')}
                    </Button>
                  ) : undefined
                }
                severity="error"
              >
                {error.message}
              </Alert>
            )}

            <TextField
              disabled={Boolean(event)}
              label={t('calendarEvents.editor.calendar', 'Calendar')}
              onChange={handleCalendarChange}
              select
              SelectProps={{ native: true }}
              value={values.calendarId}
            >
              {(event ? calendars : writableCalendars).map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </TextField>

            <TextField
              autoFocus
              label={t('calendarEvents.editor.title', 'Title')}
              onChange={handleChange('title')}
              required
              value={values.title}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={values.timingType === 'all-day'}
                  onChange={handleTimingTypeChange}
                />
              }
              label={t('calendarEvents.editor.allDay', 'All day')}
            />

            <TextField
              InputLabelProps={{ shrink: true }}
              label={t('calendarEvents.editor.start', 'Start')}
              onChange={handleChange('start')}
              required
              type={values.timingType === 'all-day' ? 'date' : 'datetime-local'}
              value={values.start}
            />

            <TextField
              InputLabelProps={{ shrink: true }}
              label={t('calendarEvents.editor.end', 'End')}
              onChange={handleChange('end')}
              required
              type={values.timingType === 'all-day' ? 'date' : 'datetime-local'}
              value={values.end}
            />

            {values.timingType === 'timed' &&
              (values.timedKind ?? 'zoned') === 'zoned' && (
                <TextField
                  label={t('calendarEvents.editor.timezone', 'Time zone')}
                  onChange={handleChange('timezone')}
                  required
                  value={values.timezone}
                />
              )}
            {values.timingType === 'timed' && timingHelpText && (
              <Typography color="text.secondary" variant="body2">
                {timingHelpText}
              </Typography>
            )}

            <TextField
              label={t('calendarEvents.editor.location', 'Location')}
              onChange={handleChange('location')}
              value={values.location}
            />

            <TextField
              label={t('calendarEvents.editor.description', 'Description')}
              multiline
              minRows={3}
              onChange={handleChange('description')}
              value={values.description}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(values.repeats)}
                  disabled={!values.recurrenceEditable}
                  onChange={handleRecurrenceToggle}
                />
              }
              label={t('calendarEvents.editor.repeats', 'Repeats')}
            />

            {values.recurrenceDisabledReason && (
              <Alert severity="info">
                {values.recurrenceDisabledReason === 'complex'
                  ? t(
                      'calendarEvents.editor.complexRecurrenceReadOnly',
                      'This event includes additional dates or exceptions. Recurrence editing is disabled, and other changes will preserve them.',
                    )
                  : t(
                      'calendarEvents.editor.unsupportedRecurrenceReadOnly',
                      'This recurrence rule or time zone is not supported for editing. Other changes will preserve it.',
                    )}
              </Alert>
            )}

            {values.repeats && values.recurrenceEditable && (
              <>
                <TextField
                  label={t('calendarEvents.editor.frequency', 'Frequency')}
                  onChange={handleChange('recurrenceFrequency')}
                  select
                  SelectProps={{ native: true }}
                  value={values.recurrenceFrequency ?? 'DAILY'}
                >
                  <option value="DAILY">
                    {t('calendarEvents.editor.daily', 'Daily')}
                  </option>
                  <option value="WEEKLY">
                    {t('calendarEvents.editor.weekly', 'Weekly')}
                  </option>
                  <option value="MONTHLY">
                    {t('calendarEvents.editor.monthly', 'Monthly')}
                  </option>
                  <option value="YEARLY">
                    {t('calendarEvents.editor.yearly', 'Yearly')}
                  </option>
                </TextField>

                <TextField
                  disabled={weeklyByDayEnabled}
                  inputProps={{ min: 1, step: 1 }}
                  label={t('calendarEvents.editor.interval', 'Repeat every')}
                  onChange={handleChange('recurrenceInterval')}
                  required
                  type="number"
                  value={values.recurrenceInterval ?? '1'}
                />

                <TextField
                  disabled={weeklyByDayEnabled}
                  label={t('calendarEvents.editor.ends', 'Ends')}
                  onChange={handleChange('recurrenceEnd')}
                  select
                  SelectProps={{ native: true }}
                  value={values.recurrenceEnd ?? 'never'}
                >
                  <option value="never">
                    {t('calendarEvents.editor.never', 'Never')}
                  </option>
                  <option value="count">
                    {t('calendarEvents.editor.afterCount', 'After occurrences')}
                  </option>
                  <option value="until">
                    {t('calendarEvents.editor.onDate', 'On date')}
                  </option>
                </TextField>

                {values.recurrenceFrequency === 'WEEKLY' && (
                  <>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={values.recurrenceWeekdays !== undefined}
                          disabled={!weeklyByDayEnabled && !canChooseWeekdays}
                          onChange={handleWeekdayModeChange}
                        />
                      }
                      label={t(
                        'calendarEvents.editor.chooseWeekdays',
                        'Choose weekdays',
                      )}
                    />
                    {!weeklyByDayEnabled && !canChooseWeekdays && (
                      <Typography color="text.secondary" variant="body2">
                        {t(
                          'calendarEvents.editor.weekdayRuleLimit',
                          'Weekday selection requires every week with no end date or count.',
                        )}
                      </Typography>
                    )}
                    {weeklyByDayEnabled && (
                      <FormControl component="fieldset">
                        <FormLabel component="legend">
                          {t('calendarEvents.editor.repeatOn', 'Repeat on')}
                        </FormLabel>
                        <FormGroup row sx={{ flexWrap: 'wrap' }}>
                          {WEEKDAYS.map((weekday) => {
                            const startWeekday =
                              calendarEventFormStartWeekday(values);
                            return (
                              <FormControlLabel
                                control={
                                  <Checkbox
                                    checked={
                                      weekday === startWeekday ||
                                      values.recurrenceWeekdays?.includes(
                                        weekday,
                                      ) === true
                                    }
                                    disabled={weekday === startWeekday}
                                    onChange={() =>
                                      handleWeekdayChange(weekday)
                                    }
                                  />
                                }
                                key={weekday}
                                label={t(
                                  `calendarEvents.editor.weekday${weekday}`,
                                  weekday,
                                )}
                              />
                            );
                          })}
                        </FormGroup>
                        <Typography color="text.secondary" variant="body2">
                          {t(
                            'calendarEvents.editor.startWeekdayRequired',
                            'The start date’s weekday is always included.',
                          )}
                        </Typography>
                      </FormControl>
                    )}
                  </>
                )}

                {values.recurrenceEnd === 'count' && (
                  <TextField
                    inputProps={{ min: 1, step: 1 }}
                    label={t(
                      'calendarEvents.editor.occurrenceCount',
                      'Number of occurrences',
                    )}
                    onChange={handleChange('recurrenceCount')}
                    required
                    type="number"
                    value={values.recurrenceCount ?? '2'}
                  />
                )}

                {values.recurrenceEnd === 'until' && (
                  <TextField
                    InputLabelProps={{ shrink: true }}
                    label={t('calendarEvents.editor.untilDate', 'Until date')}
                    onChange={handleChange('recurrenceUntil')}
                    required
                    type="date"
                    value={values.recurrenceUntil ?? ''}
                  />
                )}

                <Typography color="text.secondary" variant="body2">
                  {t(
                    'calendarEvents.editor.seriesOnly',
                    'Changes apply to the entire series.',
                  )}
                </Typography>
              </>
            )}

            {validationError && (
              <Alert severity="warning">{validationError}</Alert>
            )}
            {readOnly && (
              <Alert severity="warning">
                {t(
                  'calendarEvents.editor.readOnly',
                  'This calendar is read-only.',
                )}
              </Alert>
            )}
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button disabled={saving} onClick={onClose}>
            {t('cancel', 'Cancel')}
          </Button>
          <LoadingButton
            disabled={Boolean(validationError) || readOnly}
            loading={saving}
            type="submit"
            variant="contained"
          >
            {event
              ? t('calendarEvents.editor.save', 'Save')
              : t('calendarEvents.editor.create', 'Create event')}
          </LoadingButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function createEventUid(): string {
  const randomId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${randomId}@matrix-calendar-widget`;
}
