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

import { Calendar, CalendarEvent } from '@matrix-calendar-widget/calendar';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import { unstable_useId as useId, visuallyHidden } from '@mui/utils';
import { DateTime } from 'luxon';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { groupCalendarEventsByDay } from '../../calendar';
import { ListEmptyState } from '../common/ListEmptyState';
import {
  CalendarColorDot,
  EventCalendarIdentity,
  eventCalendarIdentities,
} from './CalendarColorDot';
import { formatCalendarEventTime } from './CalendarEventDetailsDialog';
import { CalendarEventsListGroup } from './CalendarEventsList/CalendarEventsListGroup';
import { useViewerToday } from './CalendarEventsList/useViewerToday';
import { formatTimeWithinDay } from './calendarEventTimeWithinDay';

export function CalendarEventsList({
  calendars = [],
  emptyState,
  events,
  onSelectEvent,
}: {
  calendars?: Calendar[];
  /**
   * Replaces the generic message shown without events. Pass `null` to show
   * nothing, for example when a notice already explains why.
   */
  emptyState?: ReactNode;
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const headingId = useId();
  const { t } = useTranslation();
  const groups = groupCalendarEventsByDay(events);
  const today = useViewerToday();
  const tomorrow = DateTime.fromISO(today).plus({ days: 1 }).toISODate();
  const identities = eventCalendarIdentities(calendars);

  return (
    <section aria-labelledby={headingId}>
      <Typography id={headingId} sx={visuallyHidden} variant="h3">
        {t('calendarEvents.title', 'Calendar events')}
      </Typography>

      <Stack aria-labelledby={headingId} component="ul" m={0} p={0}>
        {groups.map(({ day, events: dayEvents }) => (
          <CalendarEventsListGroup
            date={day}
            key={day}
            relativeDay={
              day === today
                ? 'today'
                : day === tomorrow
                  ? 'tomorrow'
                  : undefined
            }
          >
            {dayEvents.map((event) => (
              <Box
                aria-label={event.title}
                component="li"
                key={`${event.calendarId}:${event.id}`}
                sx={{ listStyleType: 'none' }}
              >
                <Card variant="outlined">
                  <CardActionArea onClick={() => onSelectEvent(event)}>
                    <CardContent
                      sx={{
                        overflowWrap: 'anywhere',
                        px: 1.5,
                        py: 1,
                        '&:last-child': { pb: 1 },
                      }}
                    >
                      <Typography fontWeight="bold" variant="body1">
                        {event.title}
                      </Typography>
                      <EventTime day={day} event={event} />
                      {event.location && (
                        <Typography color="text.secondary" variant="body2">
                          {event.location}
                        </Typography>
                      )}
                      <EventCalendar
                        identity={identities.get(event.calendarId)}
                      />
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Box>
            ))}
          </CalendarEventsListGroup>
        ))}

        {groups.length === 0 && emptyState === undefined && (
          <ListEmptyState
            message={t(
              'calendarEvents.empty',
              'No events scheduled that match the selected filters.',
            )}
          />
        )}
        {groups.length === 0 && emptyState && (
          <Box component="li" sx={{ listStyleType: 'none' }}>
            {emptyState}
          </Box>
        )}
      </Stack>
    </section>
  );
}

/**
 * The day heading already shows the date, so the card repeats it only when the
 * heading can't speak for the event. Assistive technology always gets the full
 * date and time, because it can reach the card without passing the heading.
 */
function EventTime({ day, event }: { day: string; event: CalendarEvent }) {
  const { i18n, t } = useTranslation();
  const allDayLabel = t('calendarEvents.details.allDay', 'All day');
  const viewerTimezone = DateTime.local().zoneName ?? 'UTC';
  const fullTime = formatCalendarEventTime(
    event,
    i18n.language,
    allDayLabel,
    viewerTimezone,
  );
  const timeWithinDay = formatTimeWithinDay(
    day,
    event,
    i18n.language,
    allDayLabel,
    viewerTimezone,
  );

  return (
    <Typography color="text.secondary" variant="body2">
      {timeWithinDay === undefined ? (
        fullTime
      ) : (
        <>
          <span aria-hidden>{timeWithinDay}</span>
          <Box component="span" sx={visuallyHidden}>
            {fullTime}
          </Box>
        </>
      )}
    </Typography>
  );
}

function EventCalendar({ identity }: { identity?: EventCalendarIdentity }) {
  const theme = useTheme();

  if (!identity) {
    return null;
  }

  return (
    <Stack alignItems="center" direction="row" spacing={1}>
      {identity.color && (
        <Box component="span" display="flex" pl="1px">
          <CalendarColorDot
            color={identity.color}
            ringColor={theme.palette.text.secondary}
          />
        </Box>
      )}
      <Typography color="text.secondary" variant="body2">
        {identity.name}
      </Typography>
    </Stack>
  );
}
