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

import {
  Calendar,
  CalendarEvent,
  CalendarEventInput,
} from '@matrix-calendar-widget/calendar';
import { LoadingButton } from '@mui/lab';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import { DateTime } from 'luxon';
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarEventFormValues,
  calendarEventInputFromForm,
  calendarEventPatchFromForm,
  calendarEventToFormValues,
  createCalendarEventFormValues,
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
} from '../../calendar';

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
  }, [event, initialCalendar, open]);

  if (!values || !initialCalendar) {
    return null;
  }

  const selectedCalendar =
    calendars.find((calendar) => calendar.id === values.calendarId) ??
    initialCalendar;
  const readOnly = Boolean(selectedCalendar.readOnly);

  const handleChange =
    (field: keyof CalendarEventFormValues) =>
    (change: ChangeEvent<HTMLInputElement>) => {
      setValues((current) =>
        current
          ? {
              ...current,
              [field]: change.target.value,
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
          }
        : current,
    );
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
        };
      }

      return {
        ...current,
        timingType,
        start: `${current.start}T09:00`,
        end: `${current.end}T10:00`,
      };
    });
  };

  const validationErrorCode = validateCalendarEventForm(values);
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
          : undefined;

  const handleSubmit = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();

    if (validationError || readOnly) {
      return;
    }

    setSaving(true);
    setError(undefined);

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
    } catch {
      setError(
        new Error(
          t('calendarEvents.editor.saveError', 'The event could not be saved.'),
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
            {error && <Alert severity="error">{error.message}</Alert>}

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

            {values.timingType === 'timed' && (
              <TextField
                label={t('calendarEvents.editor.timezone', 'Time zone')}
                onChange={handleChange('timezone')}
                required
                value={values.timezone}
              />
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

export type CalendarEventValidationError =
  | 'title-required'
  | 'invalid-range'
  | 'invalid-timezone';

export function validateCalendarEventForm(
  values: CalendarEventFormValues,
): CalendarEventValidationError | undefined {
  if (!values.title.trim()) {
    return 'title-required';
  }

  if (values.timingType === 'all-day') {
    const start = DateTime.fromISO(values.start);
    const end = DateTime.fromISO(values.end);

    if (!start.isValid || !end.isValid || end < start) {
      return 'invalid-range';
    }

    return undefined;
  }

  if (
    !values.timezone.trim() ||
    !DateTime.local().setZone(values.timezone).isValid
  ) {
    return 'invalid-timezone';
  }

  const start = DateTime.fromISO(values.start, { zone: values.timezone });
  const end = DateTime.fromISO(values.end, { zone: values.timezone });

  if (!start.isValid || !end.isValid || end <= start) {
    return 'invalid-range';
  }

  return undefined;
}

function createEventUid(): string {
  const randomId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${randomId}@matrix-calendar-widget`;
}
