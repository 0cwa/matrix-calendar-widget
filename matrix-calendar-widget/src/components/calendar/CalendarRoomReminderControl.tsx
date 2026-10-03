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
  CalendarEventDuration,
  CalendarEventId,
  CalendarId,
} from '@matrix-calendar-widget/calendar';
import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarRoomReminderAlarmOption,
  CalendarRoomReminderIdentity,
  isCalendarRoomReminderRepository,
  useCalendarRepository,
} from '../../calendar';

type CalendarRoomReminderControlProps = {
  calendarId: CalendarId;
  eventId: CalendarEventId;
  eventUid: string;
  canManageReminders: boolean;
};

export function CalendarRoomReminderControl({
  calendarId,
  eventId,
  eventUid,
  canManageReminders,
}: CalendarRoomReminderControlProps) {
  const { t } = useTranslation();
  const repository = useCalendarRepository();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [options, setOptions] = useState<CalendarRoomReminderAlarmOption[]>([]);
  const [identities, setIdentities] = useState<
    Record<string, CalendarRoomReminderIdentity>
  >({});
  const requestSequence = useRef(0);

  useEffect(() => {
    requestSequence.current += 1;
    setOpen(false);
    setLoading(false);
    setSaving(false);
    setError(false);
    setOptions([]);
    setIdentities({});
  }, [calendarId, eventId, eventUid]);

  if (!canManageReminders || !isCalendarRoomReminderRepository(repository)) {
    return null;
  }

  const load = async () => {
    const requestId = ++requestSequence.current;
    setOpen(true);
    setLoading(true);
    setError(false);
    setOptions([]);
    setIdentities({});
    try {
      const [availableOptions, configurations] = await Promise.all([
        repository.listRoomReminderAlarmOptions(calendarId, eventId),
        repository.listRoomReminderConfigurations(),
      ]);
      if (requestSequence.current !== requestId) return;
      const eventOptions = availableOptions.filter(
        (candidate) => candidate.eventUid === eventUid,
      );
      const seen = new Set<string>();
      const enabled: Record<string, CalendarRoomReminderIdentity> = {};
      for (const candidate of eventOptions) {
        const key = reminderOptionKey(candidate);
        if (seen.has(key)) {
          throw new Error('Ambiguous room reminder option');
        }
        seen.add(key);

        const matches = configurations.filter(
          (configuration) =>
            configuration.eventUid === candidate.eventUid &&
            configuration.alarmUid === candidate.alarmUid &&
            configuration.recurrenceId === candidate.recurrenceId,
        );
        if (matches.length > 1) {
          throw new Error('Ambiguous room reminder configuration');
        }
        if (matches.length === 1) {
          enabled[key] = matches[0];
        }
      }
      setOptions(eventOptions);
      setIdentities(enabled);
    } catch {
      if (requestSequence.current === requestId) setError(true);
    } finally {
      if (requestSequence.current === requestId) setLoading(false);
    }
  };

  const toggle = async (
    option: CalendarRoomReminderAlarmOption,
    enabled: boolean,
  ) => {
    if (saving) return;
    const requestId = requestSequence.current;
    const key = reminderOptionKey(option);
    const identity = identities[key];
    setSaving(true);
    setError(false);
    try {
      if (enabled) {
        const created = await repository.enableRoomReminder(
          calendarId,
          eventId,
          option.alarmUid,
          option.recurrenceId,
        );
        if (requestSequence.current !== requestId) return;
        if (
          created.eventUid !== eventUid ||
          created.alarmUid !== option.alarmUid ||
          created.recurrenceId !== option.recurrenceId
        ) {
          throw new Error('Reminder identity changed');
        }
        setIdentities((current) => ({ ...current, [key]: created }));
      } else {
        if (!identity) {
          throw new Error('Reminder identity is unavailable');
        }
        await repository.disableRoomReminder(identity);
        if (requestSequence.current !== requestId) return;
        setIdentities((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    } catch {
      if (requestSequence.current === requestId) setError(true);
    } finally {
      if (requestSequence.current === requestId) setSaving(false);
    }
  };

  return (
    <Stack spacing={0.5}>
      <Button
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : void load())}
        size="small"
        sx={{ alignSelf: 'flex-start' }}
      >
        {open
          ? t('calendarEvents.roomReminder.close', 'Close room reminder')
          : t('calendarEvents.roomReminder.action', 'Notify room')}
      </Button>
      {open && (
        <Stack spacing={0.75}>
          <Typography variant="body2">
            {t(
              'calendarEvents.roomReminder.description',
              'Configure a room mention for this alarm. Delivery also requires reminder delivery to be enabled and current room permissions.',
            )}
          </Typography>
          {loading && <CircularProgress size={20} />}
          {!loading && !error && options.length === 0 && (
            <Alert severity="info">
              {t(
                'calendarEvents.roomReminder.unsupported',
                'This alarm is not available for room reminders.',
              )}
            </Alert>
          )}
          {!loading &&
            options.map((option, index) => {
              const key = reminderOptionKey(option);
              return (
                <FormControlLabel
                  key={key}
                  control={
                    <Checkbox
                      checked={Boolean(identities[key])}
                      disabled={saving}
                      onChange={(_, checked) => void toggle(option, checked)}
                    />
                  }
                  label={formatOption(option, index + 1, t)}
                />
              );
            })}
          {saving && <CircularProgress size={20} />}
          {error && (
            <Alert severity="error">
              {t(
                'calendarEvents.roomReminder.error',
                'Room reminder settings are unavailable. Try again later.',
              )}
            </Alert>
          )}
        </Stack>
      )}
    </Stack>
  );
}

function formatOption(
  option: CalendarRoomReminderAlarmOption,
  index: number,
  t: TFunction,
): string {
  const duration = formatDuration(option.trigger);
  const relative =
    option.relatedTo === 'start'
      ? t(
          'calendarEvents.roomReminder.relativeToStart',
          '{{duration}} relative to event start',
          { duration },
        )
      : t(
          'calendarEvents.roomReminder.relativeToEnd',
          '{{duration}} relative to event end',
          { duration },
        );
  const timing = !option.repeat
    ? relative
    : t(
        'calendarEvents.roomReminder.repeatLabel',
        '{{timing}}; repeats {{count}} times every {{interval}}',
        {
          timing: relative,
          count: option.repeat.count,
          interval: formatDuration(option.repeat.interval),
        },
      );
  return t(
    'calendarEvents.roomReminder.optionLabel',
    'Alarm {{index}}: {{timing}}',
    { index, timing },
  );
}

function reminderOptionKey(option: CalendarRoomReminderAlarmOption): string {
  return JSON.stringify([
    option.eventUid,
    option.alarmUid,
    option.recurrenceId,
  ]);
}

function formatDuration(duration: CalendarEventDuration): string {
  const parts = [
    duration.weeks > 0 ? `${duration.weeks}w` : undefined,
    duration.days > 0 ? `${duration.days}d` : undefined,
    duration.hours > 0 ? `${duration.hours}h` : undefined,
    duration.minutes > 0 ? `${duration.minutes}m` : undefined,
    duration.seconds > 0 ? `${duration.seconds}s` : undefined,
  ].filter((part): part is string => part !== undefined);
  const value = parts.length > 0 ? parts.join(' ') : '0s';
  return duration.isNegative ? `−${value}` : value;
}
