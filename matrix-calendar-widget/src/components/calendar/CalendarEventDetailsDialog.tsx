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
  CalendarEvent,
  isAllDayCalendarEvent,
} from '@matrix-calendar-widget/calendar';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';

export function CalendarEventDetailsDialog({
  event,
  onClose,
}: {
  event?: CalendarEvent;
  onClose: () => void;
}) {
  const { i18n, t } = useTranslation();

  return (
    <Dialog fullWidth maxWidth="sm" onClose={onClose} open={Boolean(event)}>
      {event && (
        <>
          <DialogTitle>{event.title}</DialogTitle>
          <DialogContent>
            <Stack spacing={1}>
              <Typography>
                {formatCalendarEventTime(
                  event,
                  i18n.language,
                  t('calendarEvents.details.allDay', 'All day'),
                )}
              </Typography>

              {event.location && (
                <Typography>
                  {t('calendarEvents.details.location', 'Location')}:{' '}
                  {event.location}
                </Typography>
              )}

              {event.description && (
                <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                  {event.description}
                </Typography>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>
              {t('calendarEvents.details.close', 'Close')}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

export function formatCalendarEventTime(
  event: CalendarEvent,
  locale: string,
  allDayLabel: string,
): string {
  if (isAllDayCalendarEvent(event)) {
    const start = DateTime.fromISO(event.timing.startDate).setLocale(locale);
    const endExclusive = DateTime.fromISO(event.timing.endDate).setLocale(
      locale,
    );
    const endInclusive = endExclusive.minus({ days: 1 });

    if (start.hasSame(endInclusive, 'day')) {
      return `${start.toLocaleString(DateTime.DATE_FULL)} · ${allDayLabel}`;
    }

    return `${start.toLocaleString(DateTime.DATE_FULL)} – ${endInclusive.toLocaleString(
      DateTime.DATE_FULL,
    )} · ${allDayLabel}`;
  }

  const start = DateTime.fromISO(event.timing.start.local, {
    zone: event.timing.start.timezone,
  }).setLocale(locale);
  const end = DateTime.fromISO(event.timing.end.local, {
    zone: event.timing.end.timezone,
  }).setLocale(locale);

  if (start.hasSame(end, 'day')) {
    return `${start.toLocaleString(DateTime.DATE_FULL)} · ${start.toLocaleString(
      DateTime.TIME_SIMPLE,
    )}–${end.toLocaleString(DateTime.TIME_SIMPLE)}`;
  }

  return `${start.toLocaleString(DateTime.DATETIME_MED)} – ${end.toLocaleString(
    DateTime.DATETIME_MED,
  )}`;
}
