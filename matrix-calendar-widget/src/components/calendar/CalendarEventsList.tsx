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

import { CalendarEvent } from '@matrix-calendar-widget/calendar';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Stack,
  Typography,
} from '@mui/material';
import { unstable_useId as useId, visuallyHidden } from '@mui/utils';
import { useTranslation } from 'react-i18next';
import { groupCalendarEventsByDay } from '../../calendar';
import { ListEmptyState } from '../common/ListEmptyState';
import { MeetingsListGroup } from '../meetings/MeetingsList/MeetingsListGroup';
import { formatCalendarEventTime } from './CalendarEventDetailsDialog';

export function CalendarEventsList({
  events,
  onSelectEvent,
}: {
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const headingId = useId();
  const { i18n, t } = useTranslation();
  const groups = groupCalendarEventsByDay(events);

  return (
    <section aria-labelledby={headingId}>
      <Typography id={headingId} sx={visuallyHidden} variant="h3">
        {t('calendarEvents.title', 'Calendar events')}
      </Typography>

      <Stack component="ul" m={0} p={0}>
        {groups.map(({ day, events: dayEvents }) => (
          <MeetingsListGroup date={day} key={day}>
            {dayEvents.map((event) => (
              <Box
                aria-label={event.title}
                component="li"
                key={`${event.calendarId}:${event.id}`}
                sx={{ listStyleType: 'none' }}
              >
                <Card variant="outlined">
                  <CardActionArea onClick={() => onSelectEvent(event)}>
                    <CardContent>
                      <Typography fontWeight="bold" variant="body1">
                        {event.title}
                      </Typography>
                      <Typography color="text.secondary" variant="body2">
                        {formatCalendarEventTime(
                          event,
                          i18n.language,
                          t('calendarEvents.details.allDay', 'All day'),
                        )}
                      </Typography>
                      {event.location && (
                        <Typography color="text.secondary" variant="body2">
                          {event.location}
                        </Typography>
                      )}
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Box>
            ))}
          </MeetingsListGroup>
        ))}

        {groups.length === 0 && (
          <ListEmptyState
            message={t(
              'calendarEvents.empty',
              'No events scheduled that match the selected filters.',
            )}
          />
        )}
      </Stack>
    </section>
  );
}
