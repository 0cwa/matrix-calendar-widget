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

import { Typography } from '@mui/material';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import {
  CalendarEventSchedule,
  CalendarOffsets,
  CalendarScheduleEndpoint,
} from './calendarEventSchedule';

/**
 * The event's time with the clock it belongs to. When the viewer's clock
 * differs from the saved zone, both readings are shown and named.
 */
export function CalendarEventDetailsSchedule({
  schedule,
  viewerTimezone,
  formatRange,
}: {
  schedule: CalendarEventSchedule;
  viewerTimezone: string;
  /** Format the event's range as read on the given zone's clock. */
  formatRange: (timezone: string) => string;
}) {
  const { i18n, t } = useTranslation();
  const offsetRange = ({ start, end }: CalendarOffsets) =>
    start === end
      ? start
      : t(
          'calendarEvents.details.offsetChange',
          '{{start}} to {{end}} after a clock change',
          { start, end },
        );
  const yourTime = (offsets: CalendarOffsets) =>
    t(
      'calendarEvents.details.yourTimeZone',
      'Your time: {{timezone}} ({{offset}})',
      { timezone: viewerTimezone, offset: offsetRange(offsets) },
    );
  const endpoint = (value: CalendarScheduleEndpoint) => {
    const time = value.local
      .setLocale(i18n.language)
      .toLocaleString(DateTime.DATETIME_MED);
    if (!value.timezone) {
      return t(
        'calendarEvents.details.endpointFloating',
        '{{time}}, floating (no fixed time zone)',
        { time },
      );
    }
    return value.offset
      ? `${time}, ${value.timezone} (${value.offset})`
      : `${time}, ${value.timezone}`;
  };

  if (schedule.kind === 'unverified') {
    return (
      <>
        <Typography>
          {t('calendarEvents.details.savedStart', 'Starts: {{time}}', {
            time: endpoint(schedule.start),
          })}
        </Typography>
        <Typography>
          {t('calendarEvents.details.savedEnd', 'Ends: {{time}}', {
            time: endpoint(schedule.end),
          })}
        </Typography>
        <Secondary>
          {t(
            'calendarEvents.details.unverifiedTimezone',
            'Shown as saved. This time zone cannot be converted reliably to yours.',
          )}
        </Secondary>
      </>
    );
  }

  return (
    <>
      <Typography>{formatRange(viewerTimezone)}</Typography>

      {schedule.kind === 'floating' && (
        <Secondary>
          {t(
            'calendarEvents.details.floatingTime',
            'Floating time with no fixed time zone. These clock times apply wherever you are.',
          )}
        </Secondary>
      )}

      {schedule.kind === 'same-clock' && (
        <Secondary>
          {`${schedule.timezone} (${offsetRange(schedule.offsets)})`}
        </Secondary>
      )}

      {schedule.kind === 'other-clock' && (
        <>
          <Secondary>{yourTime(schedule.viewerOffsets)}</Secondary>
          <Typography sx={{ pt: 1 }}>
            {formatRange(schedule.timezone)}
          </Typography>
          <Secondary>
            {t(
              'calendarEvents.details.eventTimeZone',
              'Event time zone: {{timezone}} ({{offset}})',
              {
                timezone: schedule.timezone,
                offset: offsetRange(schedule.offsets),
              },
            )}
          </Secondary>
        </>
      )}

      {schedule.kind === 'mixed' && (
        <>
          <Secondary>{yourTime(schedule.viewerOffsets)}</Secondary>
          <Typography sx={{ pt: 1 }} variant="body2">
            {t('calendarEvents.details.savedStart', 'Starts: {{time}}', {
              time: endpoint(schedule.start),
            })}
          </Typography>
          <Typography variant="body2">
            {t('calendarEvents.details.savedEnd', 'Ends: {{time}}', {
              time: endpoint(schedule.end),
            })}
          </Typography>
        </>
      )}
    </>
  );
}

function Secondary({ children }: { children: string }) {
  return (
    <Typography color="text.secondary" variant="body2">
      {children}
    </Typography>
  );
}
