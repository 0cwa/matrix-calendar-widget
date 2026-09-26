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
  CalendarRepositoryError,
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
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { DateTime } from 'luxon';
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarEventFormValues,
  calendarEventInputFromForm,
  calendarEventPatchFromForm,
  CalendarEventRecurrenceDateMode,
  CalendarEventRecurrenceDateValue,
  calendarEventToFormValues,
  createCalendarEventFormValues,
  hasInvalidCalendarEventRecurrenceFormValues,
  hasRecurrenceDateTypeMismatch,
  recurrenceDateValueFromForm,
  recurrenceDateValueMatchesTimingType,
  useCalendarRepository,
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
} from '../../calendar';
import { RecurrenceEditor } from '../meetings/RecurrenceEditor/RecurrenceEditor';

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
  const [formSession, setFormSession] = useState(0);
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
    setFormSession((current) => current + 1);
    setError(undefined);
    setConflict(false);
  }, [event, initialCalendar, open]);

  const handleRecurrenceRuleChange = useCallback(
    (rule: string | undefined, isValid: boolean, isDirty: boolean) => {
      setValues((current) => {
        if (!current) {
          return current;
        }

        const recurrence = current.recurrence;
        const changed = isDirty && rule !== recurrence.rule;
        const ruleEdited = recurrence.ruleEdited || changed;
        const nextRule = changed ? rule : recurrence.rule;
        const nextRuleValid = isValid;
        if (
          ruleEdited === recurrence.ruleEdited &&
          nextRule === recurrence.rule &&
          nextRuleValid === recurrence.ruleValid
        ) {
          return current;
        }

        return {
          ...current,
          recurrence: {
            ...recurrence,
            rule: nextRule,
            ruleEdited,
            ruleValid: nextRuleValid,
          },
        };
      });
    },
    [],
  );

  const recurrenceStart = values?.start;
  const recurrenceTimingType = values?.timingType;
  const recurrenceTimezone = values?.timezone;
  const recurrenceStartDate = useMemo(() => {
    if (!recurrenceStart || !recurrenceTimingType || !recurrenceTimezone) {
      return new Date(0);
    }
    const startDate = DateTime.fromISO(recurrenceStart, {
      zone: recurrenceTimingType === 'all-day' ? 'UTC' : recurrenceTimezone,
    });
    return startDate.isValid ? startDate.toJSDate() : new Date(0);
  }, [recurrenceStart, recurrenceTimingType, recurrenceTimezone]);

  if (!values || !initialCalendar) {
    return null;
  }

  const selectedCalendar =
    calendars.find((calendar) => calendar.id === values.calendarId) ??
    initialCalendar;
  const readOnly = Boolean(selectedCalendar.readOnly);
  const recurrenceTimingTypeLocked = recurrenceHasTimingData(values.recurrence);

  const handleRecurrenceDateRowsChange = (
    field: 'rdates' | 'exdates',
    rows: CalendarEventRecurrenceDateValue[],
  ) => {
    setValues((current) =>
      current
        ? {
            ...current,
            recurrence: {
              ...current.recurrence,
              [field]: rows,
              [`${field}Edited`]: true,
            },
          }
        : current,
    );
  };

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
      if (
        !current ||
        current.timingType === timingType ||
        recurrenceHasTimingData(current.recurrence)
      ) {
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

  const recurrenceDateTypeMismatch = hasRecurrenceDateTypeMismatch(
    values.recurrence,
    values.timingType,
  );
  const recurrenceValidationError = hasInvalidCalendarEventRecurrenceFormValues(
    values.recurrence,
    values.timingType,
    values.timezone,
  );
  const formValidationError =
    validationError ||
    (recurrenceValidationError
      ? recurrenceDateTypeMismatch
        ? t(
            'calendarEvents.editor.recurrenceDateTypeMismatch',
            'Recurrence dates must use the same date or date-time type as the event start. Correct or remove incompatible saved values before changing recurrence.',
          )
        : t(
            'calendarEvents.editor.invalidRecurrence',
            'Check the recurrence rule and date values.',
          )
      : undefined);

  const handleSubmit = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();

    if (formValidationError || readOnly) {
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
                  disabled={recurrenceTimingTypeLocked}
                  onChange={handleTimingTypeChange}
                />
              }
              label={t('calendarEvents.editor.allDay', 'All day')}
            />
            {recurrenceTimingTypeLocked && (
              <Alert severity="info">
                {t(
                  'calendarEvents.editor.recurrenceTimingTypeLocked',
                  'The timed or all-day type cannot change while recurrence data is present. Remove and save recurrence first.',
                )}
              </Alert>
            )}

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

            <Stack spacing={1}>
              <Typography component="h3" variant="subtitle1">
                {t('calendarEvents.editor.recurrence', 'Repeat')}
              </Typography>

              {values.recurrence.original?.rrule &&
                !values.recurrence.ruleEditable &&
                !values.recurrence.ruleEdited && (
                  <Alert
                    action={
                      <Button
                        color="inherit"
                        onClick={() =>
                          setValues((current) =>
                            current
                              ? {
                                  ...current,
                                  recurrence: {
                                    ...current.recurrence,
                                    rule: undefined,
                                    ruleEditable: true,
                                    ruleEdited: true,
                                    ruleValid: true,
                                  },
                                }
                              : current,
                          )
                        }
                        size="small"
                      >
                        {t(
                          'calendarEvents.editor.replaceUnsupportedRule',
                          'Replace with a supported rule',
                        )}
                      </Button>
                    }
                    severity="warning"
                  >
                    {t(
                      'calendarEvents.editor.unsupportedRule',
                      'This recurrence has options this form cannot edit. It will be preserved unless you replace it with a supported rule.',
                    )}
                  </Alert>
                )}

              {values.recurrence.ruleEditable && open && (
                <RecurrenceEditor
                  key={`${formSession}-${event?.id ?? 'new'}`}
                  isMeetingCreation={!event}
                  onChange={handleRecurrenceRuleChange}
                  repeatLabel={t(
                    'calendarEvents.editor.repeat',
                    'Repeat event',
                  )}
                  rule={values.recurrence.rule}
                  startDate={recurrenceStartDate}
                />
              )}

              <RecurrenceDateRows
                defaultTimezone={values.timezone}
                label={t(
                  'calendarEvents.editor.additionalDates',
                  'Additional dates',
                )}
                onChange={(rows) =>
                  handleRecurrenceDateRowsChange('rdates', rows)
                }
                rows={values.recurrence.rdates}
                type="rdate"
                timingType={values.timingType}
                start={values.start}
              />
              <RecurrenceDateRows
                defaultTimezone={values.timezone}
                label={t(
                  'calendarEvents.editor.excludedDates',
                  'Excluded dates',
                )}
                onChange={(rows) =>
                  handleRecurrenceDateRowsChange('exdates', rows)
                }
                rows={values.recurrence.exdates}
                type="exdate"
                timingType={values.timingType}
                start={values.start}
              />
              {values.recurrence.original?.rdatePeriods?.length ? (
                <Alert severity="info">
                  {values.timingType === 'all-day'
                    ? t(
                        'calendarEvents.editor.periodsPreservedIncompatible',
                        'Additional dates with durations are preserved. Their date-time type does not match this all-day event, so remove them with a compatible CalDAV editor before changing recurrence.',
                      )
                    : t(
                        'calendarEvents.editor.periodsPreserved',
                        'Additional dates with their own durations are preserved and are not editable here.',
                      )}
                </Alert>
              ) : null}
              {recurrenceValidationError && (
                <Alert severity="error">
                  {recurrenceDateTypeMismatch
                    ? t(
                        'calendarEvents.editor.recurrenceDateTypeMismatch',
                        'Recurrence dates must use the same date or date-time type as the event start. Correct or remove incompatible saved values before changing recurrence.',
                      )
                    : t(
                        'calendarEvents.editor.invalidRecurrence',
                        'Check the recurrence rule and date values.',
                      )}
                </Alert>
              )}
            </Stack>

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
            disabled={Boolean(formValidationError) || readOnly}
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

function recurrenceHasTimingData(
  recurrence: CalendarEventFormValues['recurrence'],
): boolean {
  const original = recurrence.original;
  return Boolean(
    original?.rrule ||
    original?.rdates?.length ||
    original?.rdatePeriods?.length ||
    original?.exdates?.length ||
    original?.recurrenceId ||
    original?.overrides?.length ||
    (recurrence.ruleEdited && recurrence.rule) ||
    (recurrence.rdatesEdited && recurrence.rdates.length > 0) ||
    (recurrence.exdatesEdited && recurrence.exdates.length > 0),
  );
}

function createEventUid(): string {
  const randomId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${randomId}@matrix-calendar-widget`;
}

function RecurrenceDateRows({
  defaultTimezone,
  label,
  onChange,
  rows,
  start,
  timingType,
  type,
}: {
  defaultTimezone: string;
  label: string;
  onChange: (rows: CalendarEventRecurrenceDateValue[]) => void;
  rows: CalendarEventRecurrenceDateValue[];
  start: string;
  timingType: CalendarEventFormValues['timingType'];
  type: 'rdate' | 'exdate';
}) {
  const { t } = useTranslation();
  const itemLabel =
    type === 'rdate'
      ? t('calendarEvents.editor.additionalDate', 'Additional date')
      : t('calendarEvents.editor.excludedDate', 'Excluded date');
  const defaultMode =
    defaultTimezone === 'UTC'
      ? 'utc'
      : defaultTimezone === 'floating'
        ? 'floating'
        : 'tzid';
  const supportedModes: {
    mode: CalendarEventRecurrenceDateMode;
    label: string;
  }[] =
    timingType === 'all-day'
      ? [
          {
            mode: 'date',
            label: t('calendarEvents.editor.dateMode', 'All-day date'),
          },
        ]
      : [
          {
            mode: 'floating',
            label: t(
              'calendarEvents.editor.floatingMode',
              'Floating local time',
            ),
          },
          {
            mode: 'utc',
            label: t('calendarEvents.editor.utcMode', 'UTC time'),
          },
          {
            mode: 'tzid',
            label: t('calendarEvents.editor.timezoneMode', 'Named time zone'),
          },
        ];

  const updateRow = (
    index: number,
    update: Partial<CalendarEventRecurrenceDateValue>,
  ) =>
    onChange(
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...update } : row,
      ),
    );

  return (
    <Stack spacing={1}>
      <Typography component="h4" variant="body1">
        {label}
      </Typography>
      {rows.map((row, index) => {
        const rowLabel = `${itemLabel} ${index + 1}`;
        const invalid = recurrenceDateValueFromForm(row) === undefined;
        const typeMismatch = !recurrenceDateValueMatchesTimingType(
          row,
          timingType,
        );
        const modeLabel =
          supportedModes.find((option) => option.mode === row.mode)?.label ??
          (row.mode === 'date'
            ? t('calendarEvents.editor.dateMode', 'All-day date')
            : row.mode === 'floating'
              ? t('calendarEvents.editor.floatingMode', 'Floating local time')
              : row.mode === 'utc'
                ? t('calendarEvents.editor.utcMode', 'UTC time')
                : t('calendarEvents.editor.timezoneMode', 'Named time zone'));
        return (
          <Stack
            alignItems="flex-start"
            direction={{ xs: 'column', sm: 'row' }}
            key={`${type}-${index}`}
            spacing={1}
          >
            <TextField
              label={t(
                'calendarEvents.editor.dateValueType',
                '{{label}} type',
                {
                  label: rowLabel,
                },
              )}
              onChange={(change) => {
                const mode = change.target
                  .value as CalendarEventRecurrenceDateValue['mode'];
                const value =
                  mode === 'date'
                    ? row.value.slice(0, 10)
                    : row.mode === 'date'
                      ? `${row.value}T00:00`
                      : row.value;
                updateRow(index, {
                  mode,
                  value,
                  timezone:
                    mode === 'tzid' ? row.timezone || defaultTimezone : '',
                });
              }}
              select
              value={row.mode}
            >
              {typeMismatch && (
                <MenuItem disabled value={row.mode}>
                  {t(
                    'calendarEvents.editor.existingIncompatibleDateMode',
                    '{{mode}} (saved value has a different type)',
                    { mode: modeLabel },
                  )}
                </MenuItem>
              )}
              {supportedModes.map((option) => (
                <MenuItem key={option.mode} value={option.mode}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              error={invalid}
              helperText={
                invalid
                  ? t(
                      'calendarEvents.editor.invalidRecurrenceDate',
                      'Enter a valid date or date and time.',
                    )
                  : undefined
              }
              InputLabelProps={{ shrink: true }}
              label={rowLabel}
              onChange={(change) =>
                updateRow(index, { value: change.target.value })
              }
              required
              type={row.mode === 'date' ? 'date' : 'datetime-local'}
              inputProps={row.mode === 'date' ? undefined : { step: 1 }}
              value={row.value}
            />
            {row.mode === 'tzid' && (
              <TextField
                error={!DateTime.local().setZone(row.timezone).isValid}
                label={t('calendarEvents.editor.timezone', 'Time zone')}
                onChange={(change) =>
                  updateRow(index, { timezone: change.target.value })
                }
                required
                value={row.timezone}
              />
            )}
            {typeMismatch && (
              <Alert severity="warning">
                {t(
                  'calendarEvents.editor.savedRecurrenceDateTypeMismatch',
                  'This saved value does not match the event start type. Correct or remove it before changing recurrence; it remains unchanged otherwise.',
                )}
              </Alert>
            )}
            <Button
              aria-label={t(
                'calendarEvents.editor.removeDate',
                'Remove {{label}}',
                {
                  label: rowLabel,
                },
              )}
              onClick={() =>
                onChange(rows.filter((_, rowIndex) => rowIndex !== index))
              }
              size="small"
            >
              {t('calendarEvents.editor.removeDateAction', 'Remove')}
            </Button>
          </Stack>
        );
      })}
      <Button
        onClick={() =>
          onChange([
            ...rows,
            timingType === 'all-day'
              ? { mode: 'date', value: start, timezone: '' }
              : {
                  mode: defaultMode,
                  value: start.length === 16 ? `${start}:00` : start,
                  timezone: defaultMode === 'tzid' ? defaultTimezone : '',
                },
          ])
        }
        size="small"
        sx={{ alignSelf: 'flex-start' }}
      >
        {type === 'rdate'
          ? t('calendarEvents.editor.addDate', 'Add date')
          : t('calendarEvents.editor.addExcludedDate', 'Add excluded date')}
      </Button>
    </Stack>
  );
}
