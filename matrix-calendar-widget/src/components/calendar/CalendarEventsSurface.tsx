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
  CalendarEventDateTime,
  CalendarId,
  projectCalendarEventOccurrenceByRecurrenceId,
  projectCalendarEventOccurrences,
} from '@matrix-calendar-widget/calendar';
import {
  Alert,
  Box,
  Checkbox,
  FormControlLabel,
  FormGroup,
} from '@mui/material';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarFilters,
  calendarEventKey,
  filterCalendarEvents,
  repositoryRangeForView,
  useCalendarEvents,
  useCalendars,
  visibleRangeForView,
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
  const viewerTimezone = DateTime.local().zoneName ?? 'UTC';
  const repositoryRange = useMemo(
    () => repositoryRangeForView(filters, view),
    [filters, view],
  );
  const events = useCalendarEvents(calendarIds, repositoryRange);
  const visibleRange = useMemo(
    () => visibleRangeForView(filters, view, viewerTimezone),
    [filters, view, viewerTimezone],
  );
  const visibleServerDiagnostics = events.diagnostics.filter(
    (diagnostic) => !hiddenCalendarIds.has(diagnostic.calendarId),
  );
  const unsupportedSeriesCount =
    events.data.filter(
      (event) =>
        event.unsupportedRecurrence === 'range-this-and-future' &&
        !hiddenCalendarIds.has(event.calendarId),
    ).length +
    visibleServerDiagnostics
      .filter(({ reason }) => reason === 'range-this-and-future')
      .reduce((total, diagnostic) => total + diagnostic.count, 0);
  const sourceEvents = useMemo(
    () =>
      events.data.filter(
        (event) =>
          !hiddenCalendarIds.has(event.calendarId) &&
          event.unsupportedRecurrence !== 'range-this-and-future',
      ),
    [events.data, hiddenCalendarIds],
  );
  const projection = useMemo(
    () =>
      projectCalendarEventOccurrences(
        sourceEvents,
        visibleRange,
        viewerTimezone,
      ),
    [sourceEvents, viewerTimezone, visibleRange],
  );
  const projectionDiagnosticCount =
    visibleServerDiagnostics
      .filter(({ reason }) => reason !== 'range-this-and-future')
      .reduce((total, diagnostic) => total + diagnostic.count, 0) +
    projection.diagnostics.filter(
      ({ sourceEvent }) =>
        sourceEvent.unsupportedRecurrence !== 'range-this-and-future',
    ).length;
  const sourceEventByOccurrenceKey = useMemo(
    () =>
      new Map(
        projection.occurrences.map(({ event, sourceEvent, recurrenceId }) => [
          calendarEventKey(event),
          { sourceEvent, recurrenceId },
        ]),
      ),
    [projection.occurrences],
  );
  const filteredEvents = useMemo(
    () =>
      filterCalendarEvents(
        projection.occurrences.map(({ event }) => event),
        filters.filterText,
      ),
    [filters.filterText, projection.occurrences],
  );
  const [selectedEvent, setSelectedEvent] = useState<
    | {
        event: CalendarEvent;
        sourceEvent: CalendarEvent;
        recurrenceId?: CalendarEventDateTime;
      }
    | undefined
  >();
  const selectEvent = (event: CalendarEvent) => {
    const occurrence = sourceEventByOccurrenceKey.get(calendarEventKey(event));
    setSelectedEvent({
      event,
      sourceEvent: occurrence?.sourceEvent ?? event,
      recurrenceId: occurrence?.recurrenceId,
    });
  };
  const hasMixedSupportedComponents = calendars.data.some(
    (calendar) =>
      calendar.supportedComponents?.includes('VEVENT') &&
      calendar.supportedComponents.some((component) => component !== 'VEVENT'),
  );

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
      {(calendars.partialAvailability || events.partialAvailability) && (
        <Box px={1} pb={1}>
          <Alert severity="warning">
            {t(
              'calendarEvents.partialAvailability',
              'Some calendars or events could not be loaded. Available calendars are still shown.',
            )}
          </Alert>
        </Box>
      )}
      {hasMixedSupportedComponents && (
        <Box px={1} pb={1}>
          <Alert severity="info">
            {t(
              'calendarEvents.mixedCompatibilityNotice',
              'One or more calendars support additional item types. The widget displays and edits VEVENT entries only.',
            )}
          </Alert>
        </Box>
      )}
      {unsupportedSeriesCount > 0 && (
        <Box px={1} pb={1}>
          <Alert severity="warning">
            {t(
              'calendarEvents.unsupportedRangeRecurrence',
              'The current renderer cannot safely display series with THISANDFUTURE range overrides. Affected series: {{count}}.',
              { count: unsupportedSeriesCount },
            )}
          </Alert>
        </Box>
      )}
      {projectionDiagnosticCount > 0 && (
        <Box px={1} pb={1}>
          <Alert severity="warning">
            {t(
              'calendarEvents.unsupportedOccurrenceProjection',
              'Some events have recurrence or timezone data that the current renderer cannot safely display. Affected events: {{count}}.',
              { count: projectionDiagnosticCount },
            )}
          </Alert>
        </Box>
      )}
      {calendars.data.length > 1 && (
        <Box px={1} pb={1}>
          <FormGroup
            aria-label={t('calendarEvents.editor.calendar', 'Calendar')}
            row
            role="group"
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
            onSelectEvent={selectEvent}
          />
        </Box>
      ) : (
        <CalendarEventsCalendar
          events={filteredEvents}
          filters={filters}
          onSelectEvent={selectEvent}
          onShowMore={onShowMore}
          view={view}
        />
      )}

      <CalendarEventDetailsDialog
        event={selectedEvent?.event}
        recurrenceId={selectedEvent?.recurrenceId}
        sourceEvent={selectedEvent?.sourceEvent}
        viewerTimezone={viewerTimezone}
        onSourceEventChange={(sourceEvent) =>
          setSelectedEvent((current) => {
            if (
              !current ||
              current.sourceEvent.id !== sourceEvent.id ||
              current.sourceEvent.calendarId !== sourceEvent.calendarId
            ) {
              return current;
            }

            // Reproject from the saved resource so occurrence selections keep
            // their original recurrence identity and projected timing.
            const selectedEvent = current.recurrenceId
              ? projectCalendarEventOccurrenceByRecurrenceId(
                  sourceEvent,
                  current.recurrenceId,
                  viewerTimezone,
                )?.event
              : sourceEvent;

            return {
              ...current,
              event: selectedEvent ?? current.event,
              sourceEvent,
            };
          })
        }
        onClose={() => setSelectedEvent(undefined)}
      />
    </>
  );
}
