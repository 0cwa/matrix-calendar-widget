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
  CalendarEventDateTime,
  CalendarEventInput,
  CalendarEventOccurrenceTextField,
  CalendarEventRecurrenceTiming,
  CalendarEventTiming,
  CalendarEventWeekday,
  CalendarRepositoryError,
  projectCalendarEventOccurrenceByRecurrenceId,
} from '@matrix-calendar-widget/calendar';
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
  calendarEventInputFromForm,
  calendarEventOccurrenceTextOperationsFromForm,
  calendarEventOccurrenceToFormValues,
  calendarEventPatchFromForm,
  calendarEventRdatePeriodDurationFromForm,
  calendarEventRdatePeriodIsEditable,
  calendarEventRdatePeriodValueFromForm,
  calendarEventToFormValues,
  createCalendarEventFormValues,
  useCalendarRepository,
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
  validateCalendarEventForm,
} from '../../calendar';

import { createAlarmHandlers } from './calendarEventAlarmHandlers';
import { createAttachmentHandlers } from './calendarEventAttachmentHandlers';
import { createRecurrenceHandlers } from './calendarEventRecurrenceHandlers';
import { calendarEventScopeAvailability } from './calendarEventScopes';
import { createTimingHandlers } from './calendarEventTimingHandlers';

export const WEEKDAYS: CalendarEventWeekday[] = [
  'MO',
  'TU',
  'WE',
  'TH',
  'FR',
  'SA',
  'SU',
];

export type CalendarEventEditorProps = {
  calendars: Calendar[];
  event?: CalendarEvent;
  occurrence?: {
    recurrenceId: CalendarEventDateTime;
    event: CalendarEvent;
  };
  onClose: () => void;
  onSaved?: (event: CalendarEvent, occurrence?: CalendarEvent) => void;
  onSaveAndConfigureRoomReminders?: (event: CalendarEvent) => void;
  onOccurrenceReloadRequired?: (sourceEvent: CalendarEvent) => void;
  open: boolean;
  viewerTimezone?: string;
  uidFactory?: () => string;
};

export type CalendarEventEditorSubmissionIntent =
  | { readonly kind: 'save' }
  | { readonly kind: 'save-and-configure-room-reminders' };

export function useCalendarEventEditor({
  calendars,
  event,
  onClose,
  onSaved,
  onSaveAndConfigureRoomReminders,
  onOccurrenceReloadRequired,
  occurrence,
  open,
  viewerTimezone = DateTime.local().zoneName ?? 'UTC',
  uidFactory = createEventUid,
}: CalendarEventEditorProps) {
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
  const [titleTouched, setTitleTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingRoomReminderSetup, setSavingRoomReminderSetup] = useState(false);
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

    setTitleTouched(false);
    setSubmitAttempted(false);
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
  const { occurrenceHasAlarm, followingSupported } =
    calendarEventScopeAvailability(
      event,
      occurrence?.recurrenceId,
      viewerTimezone,
    );
  const attachmentControlsDisabled = Boolean(
    readOnly ||
    chooseScope ||
    editingOccurrence ||
    editingFollowing ||
    values.attachmentEditable === false ||
    saving,
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
      if (field === 'title') setTitleTouched(true);
      setValues((current) =>
        current
          ? {
              ...current,
              [field]: change.target.value,
              ...(field === 'conferenceUrl' && !change.target.value.trim()
                ? { conferenceLabel: '' }
                : {}),
              ...(field === 'start' || field === 'end'
                ? { timingChanged: true }
                : {}),
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

  // Choosing the current zone again is not an edit: marking it changed would
  // rewrite saved endpoints and block exclusive recurrence-date operations.
  const handleTimezoneChange = (timezone: string) => {
    setValues((current) =>
      current && current.timezone !== timezone
        ? {
            ...current,
            timezone,
            timingChanged: true,
            timezoneChanged: true,
          }
        : current,
    );
  };

  const { handleAttachmentOperationChange, handleAttachmentSourceChange } =
    createAttachmentHandlers(setValues);

  const { handleCalendarChange, handleTimingTypeChange } = createTimingHandlers(
    setValues,
    calendars,
  );

  const {
    handleAlarmToggle,
    handleAlarmDurationChange,
    handleAlarmModeChange,
  } = createAlarmHandlers(setValues);

  const {
    handleRecurrenceToggle,
    handleRdateDraftChange,
    handleRdatePeriodEndChange,
    handleRdatePeriodDurationChange,
    handleAddRdate,
    handleAddPeriodRdate,
    handleEditPeriodRdate,
    handleSavePeriodEdit,
    handleRemoveRdate,
    handleCancelRdate,
    handleRemoveExdate,
    handleCancelExdate,
    handleWeekdayModeChange,
    handleMonthlyByDayChange,
    handleWeekdayChange,
  } = createRecurrenceHandlers(setValues, values, periodValue, WEEKDAYS);

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
            : validationErrorCode === 'invalid-alarm-utc'
              ? t(
                  'calendarEvents.editor.invalidAlarmUtcDateTime',
                  'Enter a valid UTC date and time in YYYY-MM-DDTHH:mm:ssZ format.',
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

  const submit = async (intent: CalendarEventEditorSubmissionIntent) => {
    setSubmitAttempted(true);
    const configureRoomRemindersAfterSave =
      intent.kind === 'save-and-configure-room-reminders' &&
      Boolean(onSaveAndConfigureRoomReminders);

    if (validationError || readOnly || chooseScope || missingOccurrence) {
      return;
    }

    setSaving(true);
    setSavingRoomReminderSetup(configureRoomRemindersAfterSave);
    setError(undefined);
    setConflict(false);

    const finishSave = (
      savedEvent: CalendarEvent,
      savedOccurrence?: CalendarEvent,
    ) => {
      onSaved?.(savedEvent, savedOccurrence);
      if (configureRoomRemindersAfterSave) {
        onSaveAndConfigureRoomReminders?.(savedEvent);
      }
      onClose();
    };

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
          finishSave(saved, { ...occurrence.event, timing });
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
            finishSave(event, occurrence.event);
            return;
          }
          const updatedOccurrence =
            projectCalendarEventOccurrenceByRecurrenceId(
              saved,
              occurrence.recurrenceId,
              viewerTimezone,
            )?.event ?? occurrence.event;
          finishSave(saved, updatedOccurrence);
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

      finishSave(saved);
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
      setSavingRoomReminderSetup(false);
    }
  };

  const handleSubmit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    void submit({ kind: 'save' });
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

  return {
    t,
    periodDurationHelperId,
    writableCalendars,
    initialCalendar,
    values,
    saving,
    savingRoomReminderSetup,
    error,
    conflict,
    missingOccurrence,
    editScope,
    selectedCalendar,
    readOnly,
    chooseScope,
    editingOccurrence,
    editingFollowing,
    occurrenceHasAlarm,
    attachmentControlsDisabled,
    followingSupported,
    periodDuration,
    periodValue,
    isRdatePeriodEditable: calendarEventRdatePeriodIsEditable,
    editingEndPeriod,
    invalidPeriodEnd,
    hasPeriodDurationInput,
    invalidPeriodDuration,
    followingTimingUnchanged,
    periodFormDisabled,
    periodDurationFields,
    occurrenceTextOperations,
    occurrenceHasChanges,
    originalTimedTiming,
    hasFloatingEndpoint,
    timingHelpText,
    handleChange,
    handleTimezoneChange,
    handleAttachmentOperationChange,
    handleAttachmentSourceChange,
    handleCalendarChange,
    handleRecurrenceToggle,
    handleAlarmToggle,
    handleAlarmDurationChange,
    handleAlarmModeChange,
    setValues,
    handleRdateDraftChange,
    handleRdatePeriodEndChange,
    handleRdatePeriodDurationChange,
    handleAddRdate,
    handleAddPeriodRdate,
    handleEditPeriodRdate,
    handleSavePeriodEdit,
    handleRemoveRdate,
    handleCancelRdate,
    handleRemoveExdate,
    handleCancelExdate,
    handleWeekdayModeChange,
    handleMonthlyByDayChange,
    handleWeekdayChange,
    handleTimingTypeChange,
    validationErrorCode,
    showTitleRequiredError:
      validationErrorCode === 'title-required' &&
      (titleTouched || submitAttempted),
    setTitleTouched,
    weeklyByDayEnabled,
    recurrenceInterval,
    canChooseWeekdays,
    validationError,
    handleSubmit,
    submit,
    handleReloadLatest,
    chooseOccurrenceScope,
    handleOccurrenceTextModeChange,
    chooseFollowingScope,
    chooseSeriesScope,
    calendars,
    event,
    onClose,
    onSaved,
    onSaveAndConfigureRoomReminders,
    onOccurrenceReloadRequired,
    occurrence,
    open,
    viewerTimezone,
    WEEKDAYS,
  };
}

export type CalendarEventEditorModel = NonNullable<
  ReturnType<typeof useCalendarEventEditor>
>;

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

export function createEventUid(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') {
    return `${crypto.randomUUID()}@matrix-calendar-widget`;
  }

  if (typeof crypto?.getRandomValues !== 'function') {
    throw new Error('Secure cryptographic randomness is unavailable');
  }

  const randomId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `${randomId}@matrix-calendar-widget`;
}
