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

import { CalendarEvent, CalendarId } from '@matrix-calendar-widget/calendar';
import {
  Alert,
  Box,
  Checkbox,
  FormControlLabel,
  FormGroup,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarFilters,
  filterCalendarEvents,
  repositoryRangeForView,
  useCalendarEvents,
  useCalendars,
} from '../../calendar';
import { PageLoader } from '../common/PageLoader';
import { ViewType } from '../meetings/MeetingsNavigation';
import { CalendarEventDetailsDialog } from './CalendarEventDetailsDialog';
import { CalendarEventsCalendar } from './CalendarEventsCalendar';
import { CalendarEventsList } from './CalendarEventsList';

export function CalendarEventsSurface({
  filters,
  onShowMore,
  view,
}: {
  filters: CalendarFilters;
  onShowMore: (date: Date) => void;
  view: ViewType;
}) {
  const { t } = useTranslation();
  const calendars = useCalendars();
  const calendarIds = useMemo(
    () => calendars.data.map((calendar) => calendar.id),
    [calendars.data],
  );
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<CalendarId>>(
    () => new Set(),
  );
  const repositoryRange = useMemo(
    () => repositoryRangeForView(filters, view),
    [filters, view],
  );
  const events = useCalendarEvents(calendarIds, repositoryRange);
  const visibleEvents = useMemo(
    () =>
      events.data.filter((event) => !hiddenCalendarIds.has(event.calendarId)),
    [events.data, hiddenCalendarIds],
  );
  const filteredEvents = useMemo(
    () => filterCalendarEvents(visibleEvents, filters.filterText),
    [filters.filterText, visibleEvents],
  );
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent>();

  if (calendars.loading || events.loading) {
    return <PageLoader />;
  }

  if (calendars.error || events.error) {
    return (
      <Box m={2}>
        <Alert severity="error">
          {t(
            'calendarEvents.loadError',
            'Calendar events could not be loaded.',
          )}
        </Alert>
      </Box>
    );
  }

  return (
    <>
      {calendars.data.length > 1 && (
        <Box px={1} pb={1}>
          <FormGroup
            aria-label={t('calendarEvents.editor.calendar', 'Calendar')}
            row
          >
            {calendars.data.map((calendar) => (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={!hiddenCalendarIds.has(calendar.id)}
                    onChange={(_, checked) => {
                      setHiddenCalendarIds((current) => {
                        const next = new Set(current);
                        if (checked) {
                          next.delete(calendar.id);
                        } else {
                          next.add(calendar.id);
                        }
                        return next;
                      });
                    }}
                    size="small"
                  />
                }
                key={calendar.id}
                label={
                  <>
                    {calendar.color && (
                      <Box
                        component="span"
                        sx={{
                          backgroundColor: calendar.color,
                          borderRadius: '50%',
                          display: 'inline-block',
                          height: 10,
                          mr: 0.75,
                          width: 10,
                        }}
                      />
                    )}
                    {calendar.name}
                  </>
                }
              />
            ))}
          </FormGroup>
        </Box>
      )}

      {view === 'list' ? (
        <Box height="100%" overflow="auto">
          <CalendarEventsList
            events={filteredEvents}
            onSelectEvent={setSelectedEvent}
          />
        </Box>
      ) : (
        <CalendarEventsCalendar
          events={filteredEvents}
          filters={filters}
          onSelectEvent={setSelectedEvent}
          onShowMore={onShowMore}
          view={view}
        />
      )}

      <CalendarEventDetailsDialog
        event={selectedEvent}
        onClose={() => setSelectedEvent(undefined)}
      />
    </>
  );
}
