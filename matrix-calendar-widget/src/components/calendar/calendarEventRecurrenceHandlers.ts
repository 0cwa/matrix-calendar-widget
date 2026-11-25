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
  CalendarEventRecurrenceDate,
  CalendarEventWeekday,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import {
  calendarEventFormStartWeekday,
  calendarEventRdatePeriodIsEditable,
  calendarEventRdatePeriodValueFromForm,
  calendarEventRdateValueFromForm,
  type CalendarEventFormValues,
} from '../../calendar';

export function createRecurrenceHandlers(
  setValues: Dispatch<SetStateAction<CalendarEventFormValues | undefined>>,
  values: CalendarEventFormValues,
  periodValue: ReturnType<typeof calendarEventRdatePeriodValueFromForm>,
  WEEKDAYS: CalendarEventWeekday[],
) {
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

  return {
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
  };
}

function periodDateTimeDraft(value: CalendarEventDateTime): string {
  return value.type === 'date-time' ? value.value.local : value.value;
}
