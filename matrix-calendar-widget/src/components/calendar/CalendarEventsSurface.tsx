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
import AddIcon from '@mui/icons-material/Add';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  LinearProgress,
} from '@mui/material';
import { DateTime } from 'luxon';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarFilters,
  calendarEventKey,
  filterCalendarEvents,
  repositoryRangeForView,
  useCalendarEvents,
  useCalendars,
  useInvalidateCalendarRepository,
  visibleRangeForView,
} from '../../calendar';
import { CalendarEventDetailsDialog } from './CalendarEventDetailsDialog';
import { CalendarEventsCalendar } from './CalendarEventsCalendar';
import {
  CalendarEventsEmptyState,
  CalendarEventsLoadError,
  CalendarEventsLoading,
} from './CalendarEventsFeedback';
import { CalendarEventsList } from './CalendarEventsList';
import { CalendarSurfaceView } from './CalendarNavigation';

export function CalendarEventsSurface({
  filters,
  onClearSearch,
  onCreateEvent,
  onShowMore,
  view,
}: {
  filters: CalendarFilters;
  /** Clears the search; the empty search result offers it when provided. */
  onClearSearch?: () => void;
  /** Opens event creation; offered only if the viewer can write a calendar. */
  onCreateEvent?: () => void;
  onShowMore: (date: Date) => void;
  view: CalendarSurfaceView;
}) {
  const { t } = useTranslation();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const invalidate = useInvalidateCalendarRepository();
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

  // The pressed control disappears with the state it changes, so keep keyboard
  // focus on the surface instead of losing it to the document.
  const keepFocus = () => surfaceRef.current?.focus();
  const roomCalendarUnavailable =
    !calendars.roomCapabilities &&
    !calendars.partialAvailability &&
    !events.partialAvailability;
  const partiallyAvailable =
    calendars.partialAvailability || events.partialAvailability;
  const query = filters.filterText?.trim();
  const searchHidesEverything = Boolean(
    query && filteredEvents.length === 0 && projection.occurrences.length > 0,
  );
  const searchEmptyState = searchHidesEverything && (
    <CalendarEventsEmptyState
      action={
        onClearSearch && (
          <Button onClick={onClearSearch} variant="outlined">
            {t('calendarEvents.noSearchResults.clear', 'Clear search')}
          </Button>
        )
      }
      description={t(
        'calendarEvents.noSearchResults.description',
        'Search checks titles, descriptions, locations and categories in the selected dates.',
      )}
      title={t(
        'calendarEvents.noSearchResults.title',
        'No events match “{{query}}”',
        { query },
      )}
    />
  );
  const listEmptyState = () => {
    if (calendars.data.length === 0) {
      // A setup or availability notice already explains why.
      return roomCalendarUnavailable || partiallyAvailable ? null : (
        <CalendarEventsEmptyState
          title={t(
            'calendarEvents.noReadableCalendar',
            'There is no calendar to show.',
          )}
        />
      );
    }

    if (searchEmptyState) {
      return searchEmptyState;
    }

    if (
      projection.occurrences.length === 0 &&
      (calendars.data.every(({ id }) => hiddenCalendarIds.has(id)) ||
        events.data.some(({ calendarId }) => hiddenCalendarIds.has(calendarId)))
    ) {
      return (
        <CalendarEventsEmptyState
          action={
            <Button
              onClick={() => {
                keepFocus();
                setHiddenCalendarIds(new Set());
              }}
              variant="outlined"
            >
              {t('calendarEvents.hiddenCalendars.show', 'Show all calendars')}
            </Button>
          }
          title={t(
            'calendarEvents.hiddenCalendars.title',
            'No events in the selected calendars',
          )}
        />
      );
    }

    // Don't call the dates empty when some of their events can't be shown.
    const incomplete =
      partiallyAvailable ||
      unsupportedSeriesCount > 0 ||
      projectionDiagnosticCount > 0;

    return (
      <CalendarEventsEmptyState
        action={
          onCreateEvent &&
          calendars.data.some(({ readOnly }) => readOnly === false) && (
            <Button
              disabled={calendars.loading}
              onClick={onCreateEvent}
              startIcon={<AddIcon />}
              variant="outlined"
            >
              {t('calendarEvents.editor.create', 'Create event')}
            </Button>
          )
        }
        description={t(
          'calendarEvents.noEvents.description',
          'Use the date controls to look at other dates.',
        )}
        title={
          incomplete
            ? t(
                'calendarEvents.noEvents.incompleteTitle',
                'No events can be shown for these dates',
              )
            : t('calendarEvents.noEvents.title', 'No events in these dates')
        }
      />
    );
  };

  const renderContent = () => {
    if (calendars.error || events.error) {
      return (
        <CalendarEventsLoadError
          error={(calendars.error ?? events.error) as Error}
          onRetry={() => {
            keepFocus();
            invalidate();
          }}
        />
      );
    }

    // Content stays during a refresh, but never stands in for another query.
    if (!calendars.hasCurrentData || !events.hasCurrentData) {
      return <CalendarEventsLoading />;
    }

    return (
      <>
        {(calendars.loading || events.loading) && (
          <LinearProgress
            aria-label={t(
              'calendarEvents.refreshing',
              'Refreshing calendar events',
            )}
            sx={{
              flexShrink: 0,
              mb: '-4px',
              position: 'sticky',
              top: 0,
              zIndex: 3,
            }}
          />
        )}
        {roomCalendarUnavailable && (
          <Box px={1} pb={1}>
            <Alert role="status" severity="info">
              {t(
                'calendarEvents.roomCalendarUnavailable',
                'A team calendar isn’t available in this room. Ask a room moderator or calendar administrator to check setup.',
              )}
            </Alert>
          </Box>
        )}
        {partiallyAvailable && (
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
          <CalendarEventsList
            calendars={calendars.data}
            emptyState={filteredEvents.length === 0 && listEmptyState()}
            events={filteredEvents}
            onSelectEvent={selectEvent}
          />
        ) : (
          <>
            {searchEmptyState}
            <CalendarEventsCalendar
              calendars={calendars.data}
              events={filteredEvents}
              filters={filters}
              onSelectEvent={selectEvent}
              onShowMore={onShowMore}
              view={view}
            />
          </>
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
  };

  return (
    // The list scrolls together with the notices above it, so a short or zoomed
    // widget can still reach its last event.
    <Box
      height="100%"
      overflow={view === 'list' ? 'auto' : undefined}
      ref={surfaceRef}
      tabIndex={-1}
    >
      {renderContent()}
    </Box>
  );
}
