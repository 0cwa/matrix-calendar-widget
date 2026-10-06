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

import type {
  CalendarEventDateTime,
  CalendarEventOccurrenceTextField,
  CalendarEventRecurrenceDate,
  CalendarEventWeekday,
} from '@matrix-calendar-widget/calendar';
import {
  Calendar,
  CalendarEvent,
  CalendarEventInput,
  CalendarEventRecurrenceTiming,
  CalendarEventTiming,
  CalendarRepositoryError,
  isSupportedCalendarEventFollowingTimingEdit,
  projectCalendarEventOccurrenceByRecurrenceId,
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
  FormHelperText,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { DateTime } from 'luxon';
import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarEventFormValues,
  calendarEventFormStartWeekday,
  calendarEventInputFromForm,
  calendarEventOccurrenceTextOperationsFromForm,
  calendarEventOccurrenceToFormValues,
  calendarEventPatchFromForm,
  calendarEventRdatePeriodDurationFromForm,
  calendarEventRdatePeriodIsEditable,
  calendarEventRdatePeriodValueFromForm,
  calendarEventRdateValueFromForm,
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
  onOccurrenceReloadRequired,
  occurrence,
  open,
  viewerTimezone = DateTime.local().zoneName ?? 'UTC',
  uidFactory = createEventUid,
}: {
  calendars: Calendar[];
  event?: CalendarEvent;
  occurrence?: {
    recurrenceId: CalendarEventDateTime;
    event: CalendarEvent;
  };
  onClose: () => void;
  onSaved?: (event: CalendarEvent, occurrence?: CalendarEvent) => void;
  onOccurrenceReloadRequired?: (sourceEvent: CalendarEvent) => void;
  open: boolean;
  viewerTimezone?: string;
  uidFactory?: () => string;
}) {
  const { t } = useTranslation();
  const periodDurationHelperId = useId();
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
  const [missingOccurrence, setMissingOccurrence] = useState(false);
  const [editScope, setEditScope] = useState<
    'occurrence' | 'following' | 'series'
  >();
  const repository = useCalendarRepository();
  const createEvent = useCreateCalendarEvent();
  const updateEvent = useUpdateCalendarEvent();

  useEffect(() => {
    if (!open) {
      setMissingOccurrence(false);
      return;
    }
    if (!initialCalendar || missingOccurrence) {
      return;
    }

    setValues(
      event
        ? calendarEventToFormValues(event, initialCalendar)
        : createCalendarEventFormValues(initialCalendar),
    );
    setError(undefined);
    setConflict(false);
    setMissingOccurrence(false);
    setEditScope(undefined);
  }, [
    event,
    initialCalendar,
    missingOccurrence,
    occurrence?.event,
    occurrence?.recurrenceId,
    open,
  ]);

  if (!values || !initialCalendar) {
    return null;
  }

  const selectedCalendar =
    calendars.find((calendar) => calendar.id === values.calendarId) ??
    initialCalendar;
  const readOnly = Boolean(selectedCalendar.readOnly);
  const chooseScope = Boolean(event && occurrence && editScope === undefined);
  const editingOccurrence = Boolean(
    event && occurrence && editScope === 'occurrence',
  );
  const editingFollowing = Boolean(
    event && occurrence && editScope === 'following',
  );
  const occurrenceHasAlarm = Boolean(event?.alarm || event?.unsupportedAlarm);
  const attachmentControlsDisabled = Boolean(
    readOnly ||
    chooseScope ||
    editingOccurrence ||
    editingFollowing ||
    values.attachmentEditable === false ||
    saving,
  );
  const followingSupported = Boolean(
    event &&
    occurrence &&
    isSupportedCalendarEventFollowingTimingEdit(
      event,
      occurrence.recurrenceId,
      viewerTimezone,
    ),
  );
  const periodDuration = calendarEventRdatePeriodDurationFromForm(values);
  const periodValue = calendarEventRdatePeriodValueFromForm(values);
  const editingEndPeriod = values.rdateEditSource?.timing.type === 'end';
  const invalidPeriodEnd =
    editingEndPeriod &&
    (!periodValue || !calendarEventRdatePeriodIsEditable(periodValue));
  const hasPeriodDurationInput =
    !editingEndPeriod &&
    [
      values.rdatePeriodWeeks,
      values.rdatePeriodDays,
      values.rdatePeriodHours,
      values.rdatePeriodMinutes,
      values.rdatePeriodSeconds,
    ].some((value) => value !== undefined && value !== '');
  const invalidPeriodDuration = hasPeriodDurationInput && !periodDuration;
  const followingTimingUnchanged =
    editingFollowing && values.timingChanged === false;
  const periodFormDisabled =
    Boolean(values.rdateOperation) ||
    values.exdateChanged === true ||
    values.recurrenceChanged === true ||
    values.timingChanged === true ||
    values.timezoneChanged === true ||
    saving;
  const periodDurationFields = [
    {
      field: 'rdatePeriodWeeks',
      label: t('calendarEvents.editor.durationWeeks', 'Weeks'),
    },
    {
      field: 'rdatePeriodDays',
      label: t('calendarEvents.editor.durationDays', 'Days'),
    },
    {
      field: 'rdatePeriodHours',
      label: t('calendarEvents.editor.durationHours', 'Hours'),
    },
    {
      field: 'rdatePeriodMinutes',
      label: t('calendarEvents.editor.durationMinutes', 'Minutes'),
    },
    {
      field: 'rdatePeriodSeconds',
      label: t('calendarEvents.editor.durationSeconds', 'Seconds'),
    },
  ] as const;
  const occurrenceTextOperations =
    calendarEventOccurrenceTextOperationsFromForm(values);
  const occurrenceHasChanges =
    values.timingChanged === true ||
    Object.keys(occurrenceTextOperations).length > 0;
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
              ...(field === 'conferenceUrl' && !change.target.value.trim()
                ? { conferenceLabel: '' }
                : {}),
              ...(field === 'start' || field === 'end' || field === 'timezone'
                ? { timingChanged: true }
                : {}),
              ...(field === 'timezone' ? { timezoneChanged: true } : {}),
              ...(field === 'conferenceUrl' || field === 'conferenceLabel'
                ? { conferenceChanged: true }
                : {}),
              ...(field === 'attachmentUrl' ? { attachmentChanged: true } : {}),
              ...(field.startsWith('recurrence')
                ? { recurrenceChanged: true }
                : {}),
            }
          : current,
      );
    };

  const handleAttachmentOperationChange = (
    change: ChangeEvent<HTMLInputElement>,
  ) => {
    const operation = change.target.value as NonNullable<
      CalendarEventFormValues['attachmentOperation']
    >;
    setValues((current) => {
      if (!current) {
        return current;
      }
      const sourceUrl =
        operation === 'set' || operation === 'remove'
          ? current.attachmentSourceUrl || current.attachmentUrls?.[0] || ''
          : '';
      return {
        ...current,
        attachmentOperation: operation,
        attachmentSourceUrl: sourceUrl,
        attachmentUrl: operation === 'set' ? sourceUrl : '',
        attachmentChanged: operation !== 'none',
      };
    });
  };

  const handleAttachmentSourceChange = (
    change: ChangeEvent<HTMLInputElement>,
  ) => {
    const sourceUrl = change.target.value;
    setValues((current) =>
      current
        ? {
            ...current,
            attachmentSourceUrl: sourceUrl,
            ...(current.attachmentOperation === 'set'
              ? { attachmentUrl: sourceUrl }
              : {}),
            attachmentChanged: true,
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

  const handleAlarmToggle = (change: ChangeEvent<HTMLInputElement>) => {
    setValues((current) =>
      current
        ? {
            ...current,
            alarmEnabled: change.target.checked,
            alarmChanged: true,
          }
        : current,
    );
  };

  const handleAlarmDurationChange =
    (field: keyof CalendarEventFormValues) =>
    (change: ChangeEvent<HTMLInputElement>) => {
      setValues((current) =>
        current
          ? {
              ...current,
              [field]: change.target.value,
              alarmChanged: true,
            }
          : current,
      );
    };

  const handleAlarmModeChange = (change: ChangeEvent<HTMLInputElement>) => {
    const alarmMode =
      change.target.value === 'absolute' ? 'absolute' : 'relative';
    setValues((current) =>
      current ? { ...current, alarmMode, alarmChanged: true } : current,
    );
  };

  const handleRdateDraftChange = (change: ChangeEvent<HTMLInputElement>) => {
    setValues((current) =>
      current ? { ...current, rdateDraft: change.target.value } : current,
    );
  };

  const handleRdatePeriodEndChange = (
    change: ChangeEvent<HTMLInputElement>,
  ) => {
    setValues((current) =>
      current ? { ...current, rdateEndDraft: change.target.value } : current,
    );
  };

  const handleRdatePeriodDurationChange =
    (field: keyof CalendarEventFormValues) =>
    (change: ChangeEvent<HTMLInputElement>) => {
      setValues((current) =>
        current ? { ...current, [field]: change.target.value } : current,
      );
    };

  const handleAddRdate = () => {
    const value = calendarEventRdateValueFromForm(values);
    if (!value) {
      return;
    }
    setValues((current) =>
      current
        ? {
            ...current,
            rdateChanged: true,
            rdateOperation: { action: 'add', value },
          }
        : current,
    );
  };

  const handleAddPeriodRdate = () => {
    const value = calendarEventRdatePeriodValueFromForm(values);
    if (!value) {
      return;
    }
    setValues((current) =>
      current
        ? {
            ...current,
            rdateChanged: true,
            rdateOperation: { action: 'add-period', value },
          }
        : current,
    );
  };

  const handleEditPeriodRdate = (
    value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  ) => {
    if (!calendarEventRdatePeriodIsEditable(value)) {
      return;
    }
    setValues((current) =>
      current
        ? {
            ...current,
            rdateEditSource: value,
            rdateDraft: periodDateTimeDraft(value.timing.start),
            rdateEndDraft:
              value.timing.type === 'end'
                ? periodDateTimeDraft(value.timing.end)
                : undefined,
            rdatePeriodWeeks:
              value.timing.type === 'duration'
                ? String(value.timing.duration.weeks)
                : undefined,
            rdatePeriodDays:
              value.timing.type === 'duration'
                ? String(value.timing.duration.days)
                : undefined,
            rdatePeriodHours:
              value.timing.type === 'duration'
                ? String(value.timing.duration.hours)
                : undefined,
            rdatePeriodMinutes:
              value.timing.type === 'duration'
                ? String(value.timing.duration.minutes)
                : undefined,
            rdatePeriodSeconds:
              value.timing.type === 'duration'
                ? String(value.timing.duration.seconds)
                : undefined,
            rdateChanged: false,
            rdateOperation: undefined,
          }
        : current,
    );
  };

  const handleSavePeriodEdit = () => {
    const source = values.rdateEditSource;
    const replacement = periodValue;
    if (!source || !replacement) {
      return;
    }
    setValues((current) =>
      current
        ? {
            ...current,
            rdateChanged: true,
            rdateOperation: {
              action: 'replace-period',
              value: source,
              replacement,
            },
          }
        : current,
    );
  };

  const handleRemoveRdate = (
    value: NonNullable<CalendarEventFormValues['rdateValues']>[number],
  ) => {
    setValues((current) =>
      current
        ? {
            ...current,
            rdateChanged: true,
            rdateOperation:
              value.type === 'period'
                ? { action: 'remove-period', value }
                : { action: 'remove', value },
          }
        : current,
    );
  };

  const handleCancelRdate = () => {
    setValues((current) =>
      current
        ? {
            ...current,
            rdateChanged: false,
            rdateOperation: undefined,
            rdateEditSource: undefined,
            rdateDraft:
              current.originalTiming?.type === 'all-day'
                ? current.originalTiming.startDate
                : current.originalTiming?.type === 'timed'
                  ? current.originalTiming.start.local.slice(0, 16)
                  : '',
            rdateEndDraft: undefined,
            rdatePeriodWeeks: undefined,
            rdatePeriodDays: undefined,
            rdatePeriodHours: undefined,
            rdatePeriodMinutes: undefined,
            rdatePeriodSeconds: undefined,
          }
        : current,
    );
  };

  const handleRemoveExdate = (
    recurrenceId: NonNullable<CalendarEventFormValues['exdateValues']>[number],
  ) => {
    setValues((current) =>
      current
        ? {
            ...current,
            exdateChanged: true,
            exdateOperation: { action: 'remove', recurrenceId },
          }
        : current,
    );
  };

  const handleCancelExdate = () => {
    setValues((current) =>
      current
        ? { ...current, exdateChanged: false, exdateOperation: undefined }
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

  const handleMonthlyByDayChange = (change: ChangeEvent<HTMLInputElement>) => {
    setValues((current) => {
      if (!current) {
        return current;
      }
      const startDate = DateTime.fromISO(current.start.slice(0, 10), {
        zone: 'UTC',
      });
      return {
        ...current,
        recurrenceMonthlyByDay: change.target.checked,
        ...(change.target.checked
          ? {
              recurrenceMonthlyOrdinal:
                current.recurrenceMonthlyOrdinal ??
                (startDate.isValid
                  ? String(Math.ceil(startDate.day / 7))
                  : '1'),
              recurrenceMonthlyWeekday:
                current.recurrenceMonthlyWeekday ??
                WEEKDAYS[startDate.weekday - 1] ??
                'MO',
            }
          : {}),
        recurrenceChanged: true,
      };
    });
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
  const recurrenceInterval = values.recurrenceInterval ?? '1';
  const canChooseWeekdays =
    /^\d+$/.test(recurrenceInterval) &&
    Number.isSafeInteger(Number(recurrenceInterval)) &&
    Number(recurrenceInterval) > 0;
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
            : validationErrorCode === 'invalid-alarm'
              ? t(
                  'calendarEvents.editor.invalidAlarm',
                  'Enter a positive lead time using whole-number duration units. Weeks cannot be combined with other units.',
                )
              : validationErrorCode === 'invalid-rdate'
                ? t(
                    'calendarEvents.editor.invalidRdateDuration',
                    'Enter a positive duration using whole-number units. Weeks cannot be combined with other units.',
                  )
                : validationErrorCode === 'invalid-conference'
                  ? t(
                      'calendarEvents.editor.invalidConference',
                      'Enter a safe HTTP(S) conference URL and a label of at most 120 characters.',
                    )
                  : validationErrorCode === 'invalid-attachment'
                    ? t(
                        'calendarEvents.editor.invalidAttachment',
                        'Enter a safe HTTP(S) attachment URL and choose one attachment operation.',
                      )
                    : undefined;

  const handleSubmit = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();

    if (validationError || readOnly || chooseScope || missingOccurrence) {
      return;
    }

    setSaving(true);
    setError(undefined);
    setConflict(false);

    try {
      let saved: CalendarEvent;

      if (event) {
        if (editingFollowing && occurrence) {
          const timing =
            calendarEventPatchFromForm(values).timing ??
            occurrence.event.timing;
          saved = await updateEvent(event.calendarId, event.id, {
            recurrence: {
              following: {
                action: 'set-timing',
                recurrenceId: occurrence.recurrenceId,
                timing: recurrenceTimingFromEventTiming(timing),
                viewerTimezone,
              },
            },
          });
          onSaved?.(saved, { ...occurrence.event, timing });
          onClose();
          return;
        }
        if (editingOccurrence && occurrence) {
          const timing = calendarEventPatchFromForm(values).timing;
          if (Object.keys(occurrenceTextOperations).length > 0) {
            saved = await updateEvent(event.calendarId, event.id, {
              recurrence: {
                occurrence: {
                  action: 'set-fields',
                  recurrenceId: occurrence.recurrenceId,
                  ...(timing
                    ? { timing: recurrenceTimingFromEventTiming(timing) }
                    : {}),
                  viewerTimezone,
                  ...occurrenceTextOperations,
                },
              },
            });
          } else if (timing) {
            saved = await updateEvent(event.calendarId, event.id, {
              recurrence: {
                occurrence: {
                  action: 'set-timing',
                  recurrenceId: occurrence.recurrenceId,
                  timing: recurrenceTimingFromEventTiming(timing),
                  viewerTimezone,
                },
              },
            });
          } else {
            onSaved?.(event, occurrence.event);
            onClose();
            return;
          }
          const updatedOccurrence =
            projectCalendarEventOccurrenceByRecurrenceId(
              saved,
              occurrence.recurrenceId,
              viewerTimezone,
            )?.event ?? occurrence.event;
          onSaved?.(saved, updatedOccurrence);
          onClose();
          return;
        }
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
      } else if (
        caught instanceof CalendarRepositoryError &&
        caught.code === 'unsupported-patch'
      ) {
        setError(new Error(caught.message));
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
      const latestOccurrence = occurrence
        ? projectCalendarEventOccurrenceByRecurrenceId(
            latest,
            occurrence.recurrenceId,
            viewerTimezone,
          )?.event
        : undefined;
      if (occurrence && !latestOccurrence) {
        setMissingOccurrence(true);
        setConflict(false);
        setError(
          new Error(
            t(
              'calendarEvents.editor.occurrenceReloadRequired',
              'The selected occurrence is no longer available or cannot be safely projected after reload. Close the editor and select a current occurrence before editing.',
            ),
          ),
        );
        onOccurrenceReloadRequired?.(latest);
        return;
      }
      const latestCalendar =
        calendars.find((calendar) => calendar.id === latest.calendarId) ??
        initialCalendar;
      setValues(calendarEventToFormValues(latest, latestCalendar));
      setEditScope(undefined);
      setConflict(false);
      setMissingOccurrence(false);
      setError(undefined);
      if (latestOccurrence) {
        onSaved?.(latest, latestOccurrence);
      } else {
        onSaved?.(latest);
      }
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

  const chooseOccurrenceScope = () => {
    if (!event || !occurrence) {
      return;
    }
    setValues(
      calendarEventOccurrenceToFormValues(
        event,
        occurrence.event,
        occurrence.recurrenceId,
        initialCalendar,
      ),
    );
    setEditScope('occurrence');
    setError(undefined);
  };

  const handleOccurrenceTextModeChange =
    (field: CalendarEventOccurrenceTextField) =>
    (change: ChangeEvent<HTMLInputElement>) => {
      const useSeriesValue = change.target.checked;
      setValues((current) => {
        if (!current || !current.occurrenceTextModes) {
          return current;
        }
        const mode = useSeriesValue ? 'series' : 'custom';
        return {
          ...current,
          occurrenceTextModes: {
            ...current.occurrenceTextModes,
            [field]: mode,
          },
          ...(useSeriesValue
            ? { [field]: current.occurrenceTextSeriesValues?.[field] ?? '' }
            : {}),
        };
      });
    };

  const chooseFollowingScope = () => {
    if (!event || !occurrence || !followingSupported || occurrenceHasAlarm) {
      return;
    }
    setValues(calendarEventToFormValues(occurrence.event, initialCalendar));
    setEditScope('following');
    setError(undefined);
  };

  const chooseSeriesScope = () => {
    if (!event) {
      return;
    }
    setValues(calendarEventToFormValues(event, initialCalendar));
    setEditScope('series');
    setError(undefined);
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
                ) : missingOccurrence ? (
                  <Button color="inherit" onClick={onClose} size="small">
                    {t('calendarEvents.details.close', 'Close')}
                  </Button>
                ) : undefined
              }
              severity="error"
            >
              {error.message}
            </Alert>
          )}
          {chooseScope ? (
            <Stack mt={1} spacing={2}>
              <Typography>
                {t(
                  'calendarEvents.editor.chooseEditScope',
                  'Choose what to edit',
                )}
              </Typography>
              {occurrenceHasAlarm && (
                <Alert severity="info">
                  {t(
                    'calendarEvents.editor.instanceAlarmBlocked',
                    'This series contains reminder data, so occurrence and following timing edits are unavailable. Edit the entire series instead.',
                  )}
                </Alert>
              )}
              {!occurrenceHasAlarm && !followingSupported && (
                <Alert severity="info">
                  {t(
                    'calendarEvents.editor.unsupportedFollowingTiming',
                    'This series cannot use a following timing edit because its recurrence data is outside the bounded rules this editor can safely write.',
                  )}
                </Alert>
              )}
              <Stack direction={{ sm: 'row', xs: 'column' }} spacing={1}>
                <Button
                  disabled={readOnly || occurrenceHasAlarm}
                  onClick={chooseOccurrenceScope}
                  variant="outlined"
                >
                  {t(
                    'calendarEvents.editor.instanceScope',
                    'This occurrence only',
                  )}
                </Button>
                <Button
                  disabled={
                    readOnly || occurrenceHasAlarm || !followingSupported
                  }
                  onClick={chooseFollowingScope}
                  variant="outlined"
                >
                  {t(
                    'calendarEvents.editor.followingScope',
                    'This and following',
                  )}
                </Button>
                <Button onClick={chooseSeriesScope} variant="outlined">
                  {t('calendarEvents.editor.seriesScope', 'Entire series')}
                </Button>
              </Stack>
            </Stack>
          ) : editingOccurrence || editingFollowing ? (
            <Stack mt={1} spacing={2}>
              <Alert severity="info">
                {editingFollowing
                  ? t(
                      'calendarEvents.editor.followingTimingOnly',
                      'This occurrence and every later occurrence will use the start and end below. Original recurrence dates and time zone stay unchanged. Timed events keep the entered elapsed duration; all-day events keep the entered whole-day duration.',
                    )
                  : t(
                      'calendarEvents.editor.instanceEditHelp',
                      'Change only this occurrence’s title, description, location, or timing.',
                    )}
              </Alert>
              {editingOccurrence &&
                (
                  [
                    {
                      field: 'title',
                      label: t('calendarEvents.editor.title', 'Title'),
                      useSeriesLabel: t(
                        'calendarEvents.editor.useSeriesTitle',
                        'Use series title',
                      ),
                    },
                    {
                      field: 'description',
                      label: t(
                        'calendarEvents.editor.description',
                        'Description',
                      ),
                      useSeriesLabel: t(
                        'calendarEvents.editor.useSeriesDescription',
                        'Use series description',
                      ),
                    },
                    {
                      field: 'location',
                      label: t('calendarEvents.editor.location', 'Location'),
                      useSeriesLabel: t(
                        'calendarEvents.editor.useSeriesLocation',
                        'Use series location',
                      ),
                    },
                  ] as const
                ).map(({ field, label, useSeriesLabel }) => {
                  const unsupported =
                    values.occurrenceTextUnsupported?.[field] === true;
                  const mode = values.occurrenceTextModes?.[field] ?? 'series';
                  return (
                    <FormControl key={field}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={mode === 'series'}
                            disabled={readOnly || saving || unsupported}
                            onChange={handleOccurrenceTextModeChange(field)}
                          />
                        }
                        label={useSeriesLabel}
                      />
                      <TextField
                        disabled={
                          readOnly || saving || unsupported || mode === 'series'
                        }
                        label={label}
                        onChange={handleChange(field)}
                        value={values[field]}
                      />
                      {unsupported && (
                        <FormHelperText>
                          {t(
                            'calendarEvents.editor.occurrenceTextUnavailable',
                            'This occurrence has text data this editor cannot safely change.',
                          )}
                        </FormHelperText>
                      )}
                    </FormControl>
                  );
                })}
              <TextField
                InputLabelProps={{ shrink: true }}
                label={t('calendarEvents.editor.start', 'Start')}
                onChange={handleChange('start')}
                required
                type={
                  values.timingType === 'all-day' ? 'date' : 'datetime-local'
                }
                value={values.start}
              />
              <TextField
                InputLabelProps={{ shrink: true }}
                label={t('calendarEvents.editor.end', 'End')}
                onChange={handleChange('end')}
                required
                type={
                  values.timingType === 'all-day' ? 'date' : 'datetime-local'
                }
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
              {timingHelpText && (
                <Typography color="text.secondary" variant="body2">
                  {timingHelpText}
                </Typography>
              )}
              {followingTimingUnchanged && (
                <Typography color="text.secondary" variant="body2">
                  {t(
                    'calendarEvents.editor.followingChangeRequired',
                    'Change the start or end before saving this and following occurrences.',
                  )}
                </Typography>
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
          ) : (
            <Stack mt={1} spacing={2}>
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
                type={
                  values.timingType === 'all-day' ? 'date' : 'datetime-local'
                }
                value={values.start}
              />

              <TextField
                InputLabelProps={{ shrink: true }}
                label={t('calendarEvents.editor.end', 'End')}
                onChange={handleChange('end')}
                required
                type={
                  values.timingType === 'all-day' ? 'date' : 'datetime-local'
                }
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

              {values.conferenceEditable === false && (
                <Alert severity="info">
                  {t(
                    'calendarEvents.editor.unsupportedConferenceReadOnly',
                    'Conference editing is unavailable for source data this editor cannot safely reconcile. Other edits will preserve it.',
                  )}
                </Alert>
              )}

              <TextField
                disabled={values.conferenceEditable === false}
                helperText={t(
                  'calendarEvents.editor.conferenceUrlHelp',
                  'Use an HTTP(S) link. Clear the URL to remove the conference link.',
                )}
                label={t(
                  'calendarEvents.editor.conferenceUrl',
                  'Conference URL',
                )}
                onChange={handleChange('conferenceUrl')}
                type="url"
                value={values.conferenceUrl}
              />

              <TextField
                disabled={values.conferenceEditable === false}
                label={t(
                  'calendarEvents.editor.conferenceLabel',
                  'Conference label',
                )}
                onChange={handleChange('conferenceLabel')}
                value={values.conferenceLabel}
              />

              {values.attachmentEditable === false && (
                <Alert severity="info">
                  {t(
                    'calendarEvents.editor.unsupportedAttachmentReadOnly',
                    'Attachment editing is unavailable for source data this editor cannot safely reconcile. Other edits will preserve it.',
                  )}
                </Alert>
              )}

              <TextField
                disabled={attachmentControlsDisabled}
                label={t(
                  'calendarEvents.editor.attachmentOperation',
                  'Attachment link',
                )}
                onChange={handleAttachmentOperationChange}
                select
                value={values.attachmentOperation ?? 'none'}
              >
                <MenuItem value="none">
                  {t('calendarEvents.editor.attachmentNoChange', 'No change')}
                </MenuItem>
                <MenuItem value="add">
                  {t('calendarEvents.editor.attachmentAdd', 'Add link')}
                </MenuItem>
                {(values.attachmentUrls?.length ?? 0) > 0 && (
                  <MenuItem value="set">
                    {t(
                      'calendarEvents.editor.attachmentReplace',
                      'Replace link',
                    )}
                  </MenuItem>
                )}
                {(values.attachmentUrls?.length ?? 0) > 0 && (
                  <MenuItem value="remove">
                    {t('calendarEvents.editor.attachmentRemove', 'Remove link')}
                  </MenuItem>
                )}
              </TextField>

              {(values.attachmentOperation === 'set' ||
                values.attachmentOperation === 'remove') && (
                <TextField
                  disabled={attachmentControlsDisabled}
                  label={t(
                    'calendarEvents.editor.attachmentSource',
                    'Existing attachment link',
                  )}
                  onChange={handleAttachmentSourceChange}
                  select
                  value={values.attachmentSourceUrl ?? ''}
                >
                  {(values.attachmentUrls ?? []).map((url) => (
                    <MenuItem key={url} value={url}>
                      {url}
                    </MenuItem>
                  ))}
                </TextField>
              )}

              {(values.attachmentOperation === 'add' ||
                values.attachmentOperation === 'set') && (
                <TextField
                  disabled={attachmentControlsDisabled}
                  error={validationErrorCode === 'invalid-attachment'}
                  helperText={t(
                    'calendarEvents.editor.attachmentUrlHelp',
                    'Use an HTTP(S) URL. The link is saved as text; no file is uploaded or fetched.',
                  )}
                  label={t(
                    'calendarEvents.editor.attachmentUrl',
                    'Attachment URL',
                  )}
                  onChange={handleChange('attachmentUrl')}
                  type="url"
                  value={values.attachmentUrl ?? ''}
                />
              )}

              {values.attachmentChanged && (
                <Typography color="text.secondary" variant="body2">
                  {t(
                    'calendarEvents.editor.attachmentWillBeSaved',
                    'One attachment link change will be applied when you save.',
                  )}
                </Typography>
              )}

              <TextField
                label={t('calendarEvents.editor.description', 'Description')}
                multiline
                minRows={3}
                onChange={handleChange('description')}
                value={values.description}
              />

              <FormControl component="fieldset">
                <FormControlLabel
                  control={
                    <Switch
                      checked={Boolean(values.alarmEnabled)}
                      disabled={values.alarmEditable === false}
                      onChange={handleAlarmToggle}
                    />
                  }
                  label={t(
                    'calendarEvents.editor.caldavAlarm',
                    'CalDAV reminder',
                  )}
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
                      aria-label={t(
                        'calendarEvents.editor.alarmMode',
                        'Alarm timing',
                      )}
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
                          onChange={handleAlarmDurationChange(
                            'alarmUtcDateTime',
                          )}
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
                        <Stack
                          direction={{ sm: 'row', xs: 'column' }}
                          spacing={1}
                        >
                          {(
                            [
                              ['alarmWeeks', 'alarmWeeks', 'Weeks before'],
                              ['alarmDays', 'alarmDays', 'Days before'],
                              ['alarmHours', 'alarmHours', 'Hours before'],
                              [
                                'alarmMinutes',
                                'alarmMinutes',
                                'Minutes before',
                              ],
                              [
                                'alarmSeconds',
                                'alarmSeconds',
                                'Seconds before',
                              ],
                            ] as const
                          ).map(([field, key, fallback]) => (
                            <TextField
                              inputProps={{ min: 0, step: 1 }}
                              key={field}
                              label={t(
                                `calendarEvents.editor.${key}`,
                                fallback,
                              )}
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
                    inputProps={{ min: 1, step: 1 }}
                    label={t('calendarEvents.editor.interval', 'Repeat every')}
                    onChange={handleChange('recurrenceInterval')}
                    required
                    type="number"
                    value={values.recurrenceInterval ?? '1'}
                  />

                  <TextField
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
                      {t(
                        'calendarEvents.editor.afterCount',
                        'After occurrences',
                      )}
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
                            'Weekday selection requires a positive whole-number interval.',
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

                  {values.recurrenceFrequency === 'MONTHLY' && (
                    <>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={Boolean(values.recurrenceMonthlyByDay)}
                            onChange={handleMonthlyByDayChange}
                          />
                        }
                        label={t(
                          'calendarEvents.editor.monthlyByDay',
                          'Repeat by weekday',
                        )}
                      />
                      {values.recurrenceMonthlyByDay && (
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          spacing={2}
                        >
                          <TextField
                            label={t(
                              'calendarEvents.editor.monthlyOrdinal',
                              'Week of the month',
                            )}
                            onChange={handleChange('recurrenceMonthlyOrdinal')}
                            select
                            SelectProps={{ native: true }}
                            value={values.recurrenceMonthlyOrdinal ?? '1'}
                          >
                            <option value="1">
                              {t('calendarEvents.editor.ordinalFirst', 'First')}
                            </option>
                            <option value="2">
                              {t(
                                'calendarEvents.editor.ordinalSecond',
                                'Second',
                              )}
                            </option>
                            <option value="3">
                              {t('calendarEvents.editor.ordinalThird', 'Third')}
                            </option>
                            <option value="4">
                              {t(
                                'calendarEvents.editor.ordinalFourth',
                                'Fourth',
                              )}
                            </option>
                            <option value="5">
                              {t('calendarEvents.editor.ordinalFifth', 'Fifth')}
                            </option>
                            <option value="-1">
                              {t('calendarEvents.editor.ordinalLast', 'Last')}
                            </option>
                          </TextField>
                          <TextField
                            label={t(
                              'calendarEvents.editor.monthlyWeekday',
                              'Weekday',
                            )}
                            onChange={handleChange('recurrenceMonthlyWeekday')}
                            select
                            SelectProps={{ native: true }}
                            value={values.recurrenceMonthlyWeekday ?? 'MO'}
                          >
                            {WEEKDAYS.map((weekday) => (
                              <option key={weekday} value={weekday}>
                                {t(
                                  `calendarEvents.editor.weekday${weekday}`,
                                  weekday,
                                )}
                              </option>
                            ))}
                          </TextField>
                        </Stack>
                      )}
                      {values.recurrenceMonthlyByDay && (
                        <Typography color="text.secondary" variant="body2">
                          {t(
                            'calendarEvents.editor.monthlyOrdinalStartHelp',
                            'The start date must match the selected weekday pattern.',
                          )}
                        </Typography>
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

              {event && values.rdateEditable && (
                <FormControl component="fieldset">
                  <FormLabel component="legend">
                    {t(
                      'calendarEvents.editor.additionalDates',
                      'Additional recurrence dates',
                    )}
                  </FormLabel>
                  <Stack spacing={1}>
                    {(values.rdateValues ?? []).map((value, index) => {
                      const label = formatRdateValue(value);
                      return (
                        <Stack
                          alignItems="center"
                          direction="row"
                          justifyContent="space-between"
                          key={`${label}-${index}`}
                        >
                          <Typography variant="body2">{label}</Typography>
                          {value.type === 'period' &&
                            calendarEventRdatePeriodIsEditable(value) && (
                              <Button
                                aria-label={t(
                                  'calendarEvents.editor.editPeriodDate',
                                  'Edit period',
                                ).concat(`: ${label}`)}
                                disabled={
                                  Boolean(values.rdateOperation) ||
                                  Boolean(values.rdateEditSource) ||
                                  values.exdateChanged === true ||
                                  values.timingChanged === true ||
                                  saving
                                }
                                onClick={() => handleEditPeriodRdate(value)}
                                type="button"
                              >
                                {t('calendarEvents.editor.editPeriod', 'Edit')}
                              </Button>
                            )}
                          <Button
                            aria-label={t(
                              value.type === 'period'
                                ? 'calendarEvents.editor.removePeriodDate'
                                : 'calendarEvents.editor.removeAdditionalDate',
                              value.type === 'period'
                                ? 'Remove period date'
                                : 'Remove additional date',
                            ).concat(`: ${label}`)}
                            disabled={
                              Boolean(values.rdateOperation) ||
                              Boolean(values.rdateEditSource) ||
                              values.exdateChanged === true ||
                              values.timingChanged === true ||
                              saving
                            }
                            onClick={() => handleRemoveRdate(value)}
                            type="button"
                          >
                            {t('calendarEvents.editor.remove', 'Remove')}
                          </Button>
                        </Stack>
                      );
                    })}
                    <TextField
                      disabled={
                        Boolean(values.rdateOperation) ||
                        values.exdateChanged === true ||
                        values.timingChanged === true ||
                        saving
                      }
                      inputProps={
                        values.originalTiming?.type === 'all-day'
                          ? { 'data-testid': 'rdate-draft' }
                          : {
                              'data-testid': 'rdate-draft',
                              step: values.rdateEditSource ? 1 : 60,
                            }
                      }
                      InputLabelProps={{ shrink: true }}
                      label={
                        values.rdateEditSource
                          ? t(
                              'calendarEvents.editor.periodStart',
                              'Period start',
                            )
                          : t(
                              'calendarEvents.editor.additionalDate',
                              'Additional date',
                            )
                      }
                      onChange={handleRdateDraftChange}
                      required
                      type={
                        values.originalTiming?.type === 'all-day'
                          ? 'date'
                          : 'datetime-local'
                      }
                      value={values.rdateDraft ?? ''}
                    />
                    {values.originalTiming?.type === 'timed' && (
                      <FormHelperText>
                        {values.rdateEditSource
                          ? t(
                              'calendarEvents.editor.periodStartEditHelp',
                              'Update the start while keeping its saved time zone and date-time kind.',
                            )
                          : t(
                              'calendarEvents.editor.periodStartHelp',
                              'For an added period, the date and time above are its start.',
                            )}
                      </FormHelperText>
                    )}
                    {values.originalTiming?.type === 'timed' &&
                      values.timingType === 'timed' && (
                        <FormControl
                          component="fieldset"
                          disabled={periodFormDisabled}
                        >
                          <FormLabel component="legend">
                            {editingEndPeriod
                              ? t(
                                  'calendarEvents.editor.periodEndGroup',
                                  'Explicit end of period',
                                )
                              : values.rdateEditSource
                                ? t(
                                    'calendarEvents.editor.existingPeriodDuration',
                                    'Duration of period',
                                  )
                                : t(
                                    'calendarEvents.editor.periodDuration',
                                    'Duration of added period',
                                  )}
                          </FormLabel>
                          {editingEndPeriod ? (
                            <>
                              <TextField
                                inputProps={{
                                  'aria-describedby': periodDurationHelperId,
                                  'data-testid': 'rdate-period-end',
                                  step: 1,
                                }}
                                InputLabelProps={{ shrink: true }}
                                label={t(
                                  'calendarEvents.editor.periodEnd',
                                  'Period end',
                                )}
                                onChange={handleRdatePeriodEndChange}
                                required
                                type="datetime-local"
                                value={values.rdateEndDraft ?? ''}
                              />
                              <FormHelperText
                                error={invalidPeriodEnd}
                                id={periodDurationHelperId}
                              >
                                {invalidPeriodEnd
                                  ? t(
                                      'calendarEvents.editor.invalidPeriodEnd',
                                      'The end must be later than the start and keep its saved date-time kind and time zone.',
                                    )
                                  : t(
                                      'calendarEvents.editor.periodEndHelp',
                                      'The explicit end keeps its saved date-time kind and time zone.',
                                    )}
                              </FormHelperText>
                            </>
                          ) : (
                            <>
                              <Stack
                                direction="row"
                                spacing={1}
                                sx={{ flexWrap: 'wrap', rowGap: 1 }}
                              >
                                {periodDurationFields.map(
                                  ({ field, label }) => (
                                    <TextField
                                      inputProps={{
                                        'aria-describedby':
                                          periodDurationHelperId,
                                        min: 0,
                                        step: 1,
                                      }}
                                      key={field}
                                      label={label}
                                      onChange={handleRdatePeriodDurationChange(
                                        field,
                                      )}
                                      size="small"
                                      sx={{
                                        flex: '1 1 84px',
                                        minWidth: 82,
                                        maxWidth: 116,
                                      }}
                                      type="number"
                                      value={values[field] ?? ''}
                                    />
                                  ),
                                )}
                              </Stack>
                              <FormHelperText
                                error={invalidPeriodDuration}
                                id={periodDurationHelperId}
                              >
                                {invalidPeriodDuration
                                  ? t(
                                      'calendarEvents.editor.invalidRdateDuration',
                                      'Enter a positive duration using whole-number units. Weeks cannot be combined with other units.',
                                    )
                                  : t(
                                      'calendarEvents.editor.periodDurationHelp',
                                      'Use positive whole numbers. Weeks cannot be combined with days or time units.',
                                    )}
                              </FormHelperText>
                            </>
                          )}
                        </FormControl>
                      )}
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ flexWrap: 'wrap' }}
                    >
                      <Button
                        disabled={
                          Boolean(values.rdateOperation) ||
                          Boolean(values.rdateEditSource) ||
                          values.exdateChanged === true ||
                          values.timingChanged === true ||
                          values.rdateDraft?.trim() === '' ||
                          saving
                        }
                        onClick={handleAddRdate}
                        type="button"
                      >
                        {t(
                          'calendarEvents.editor.addAdditionalDate',
                          'Add date',
                        )}
                      </Button>
                      {values.rdateEditSource ? (
                        <Button
                          aria-describedby={
                            editingEndPeriod
                              ? undefined
                              : periodDurationHelperId
                          }
                          disabled={
                            periodFormDisabled ||
                            !periodValue ||
                            invalidPeriodEnd
                          }
                          onClick={handleSavePeriodEdit}
                          type="button"
                        >
                          {t(
                            'calendarEvents.editor.savePeriodChanges',
                            'Save period changes',
                          )}
                        </Button>
                      ) : (
                        values.originalTiming?.type === 'timed' &&
                        values.timingType === 'timed' && (
                          <Button
                            aria-describedby={periodDurationHelperId}
                            disabled={periodFormDisabled || !periodValue}
                            onClick={handleAddPeriodRdate}
                            type="button"
                          >
                            {t(
                              'calendarEvents.editor.addPeriodDate',
                              'Add period',
                            )}
                          </Button>
                        )
                      )}
                      {(values.rdateOperation || values.rdateEditSource) && (
                        <Button
                          disabled={saving}
                          onClick={handleCancelRdate}
                          type="button"
                        >
                          {t(
                            'calendarEvents.editor.cancelDateChange',
                            'Cancel date change',
                          )}
                        </Button>
                      )}
                    </Stack>
                    {values.rdateOperation && (
                      <Typography color="text.secondary" variant="body2">
                        {values.rdateOperation.action === 'add'
                          ? t(
                              'calendarEvents.editor.dateWillBeAdded',
                              'The date will be added when you save.',
                            )
                          : values.rdateOperation.action === 'add-period'
                            ? t(
                                'calendarEvents.editor.periodWillBeAdded',
                                'The period will be added when you save.',
                              )
                            : values.rdateOperation.action === 'replace-period'
                              ? t(
                                  'calendarEvents.editor.periodWillBeUpdated',
                                  'The period will be updated when you save.',
                                )
                              : t(
                                  'calendarEvents.editor.dateWillBeRemoved',
                                  'The date will be removed when you save.',
                                )}
                      </Typography>
                    )}
                  </Stack>
                </FormControl>
              )}

              {event && values.exdateEditable && (
                <FormControl component="fieldset">
                  <FormLabel component="legend">
                    {t('calendarEvents.editor.excludedDates', 'Excluded dates')}
                  </FormLabel>
                  <Stack spacing={1}>
                    {(values.exdateValues ?? []).map((value, index) => {
                      const label = formatRdateDateTime(value);
                      return (
                        <Stack
                          alignItems="center"
                          direction="row"
                          justifyContent="space-between"
                          key={`${label}-${index}`}
                        >
                          <Typography variant="body2">{label}</Typography>
                          <Button
                            aria-label={t(
                              'calendarEvents.editor.removeExcludedDate',
                              'Remove excluded date',
                            ).concat(`: ${label}`)}
                            disabled={
                              Boolean(values.exdateOperation) ||
                              Boolean(values.rdateOperation) ||
                              values.timingChanged === true ||
                              saving
                            }
                            onClick={() => handleRemoveExdate(value)}
                            type="button"
                          >
                            {t('calendarEvents.editor.remove', 'Remove')}
                          </Button>
                        </Stack>
                      );
                    })}
                    {values.exdateOperation && (
                      <Stack direction="row" spacing={1}>
                        <Button
                          disabled={saving}
                          onClick={handleCancelExdate}
                          type="button"
                        >
                          {t(
                            'calendarEvents.editor.cancelDateChange',
                            'Cancel date change',
                          )}
                        </Button>
                        <Typography color="text.secondary" variant="body2">
                          {t(
                            'calendarEvents.editor.excludedDateWillBeRemoved',
                            'The excluded date will be removed when you save.',
                          )}
                        </Typography>
                      </Stack>
                    )}
                  </Stack>
                </FormControl>
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
          )}
        </DialogContent>

        <DialogActions>
          <Button disabled={saving} onClick={onClose}>
            {t('cancel', 'Cancel')}
          </Button>
          <LoadingButton
            disabled={
              Boolean(validationError) ||
              readOnly ||
              chooseScope ||
              missingOccurrence ||
              followingTimingUnchanged ||
              (editingOccurrence && !occurrenceHasChanges)
            }
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

function formatRdateValue(
  value: import('@matrix-calendar-widget/calendar').CalendarEventRecurrenceDate,
): string {
  if (value.type === 'period') {
    const { timing } = value;
    return timing.type === 'end'
      ? `${formatRdateDateTime(timing.start)} – ${formatRdateDateTime(timing.end)}`
      : `${formatRdateDateTime(timing.start)} (${formatRdateDuration(timing.duration)})`;
  }
  return formatRdateDateTime(value);
}

function recurrenceTimingFromEventTiming(
  timing: CalendarEventTiming,
): CalendarEventRecurrenceTiming {
  if (timing.type === 'all-day') {
    return {
      type: 'end',
      start: { type: 'date', value: timing.startDate },
      end: { type: 'date', value: timing.endDate },
    };
  }

  const endpoint = (value: (typeof timing)['start']): CalendarEventDateTime =>
    value.type === 'floating'
      ? {
          type: 'floating-date-time',
          value: localDateTimeWithSeconds(value.local),
        }
      : {
          type: 'date-time',
          value: {
            local: localDateTimeWithSeconds(value.local),
            timezone: value.timezone,
          },
        };

  return {
    type: 'end',
    start: endpoint(timing.start),
    end: endpoint(timing.end),
  };
}

function localDateTimeWithSeconds(local: string): string {
  return local.length === 16 ? `${local}:00` : local;
}

function formatRdateDateTime(
  value: import('@matrix-calendar-widget/calendar').CalendarEventDateTime,
): string {
  switch (value.type) {
    case 'date':
      return value.value;
    case 'floating-date-time':
      return value.value;
    case 'date-time':
      return `${value.value.local} ${value.value.timezone}`;
  }
}

function periodDateTimeDraft(value: CalendarEventDateTime): string {
  return value.type === 'date-time' ? value.value.local : value.value;
}

function formatRdateDuration(
  duration: import('@matrix-calendar-widget/calendar').CalendarEventDuration,
): string {
  const parts = [
    duration.weeks && `${duration.weeks}w`,
    duration.days && `${duration.days}d`,
    duration.hours && `${duration.hours}h`,
    duration.minutes && `${duration.minutes}m`,
    duration.seconds && `${duration.seconds}s`,
  ].filter(Boolean);
  return `${duration.isNegative ? '−' : ''}${parts.join(' ') || '0s'}`;
}

function createEventUid(): string {
  const randomId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${randomId}@matrix-calendar-widget`;
}
