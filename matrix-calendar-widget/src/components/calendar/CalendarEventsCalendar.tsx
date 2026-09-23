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
  EventClickArg,
  EventContentArg,
  EventMountArg,
  MoreLinkArg,
  MoreLinkMountArg,
  MoreLinkSimpleAction,
} from '@fullcalendar/core';
import deLocale from '@fullcalendar/core/locales/de';
import FullCalendar from '@fullcalendar/react';
import {
  CalendarEvent,
  isAllDayCalendarEvent,
} from '@matrix-calendar-widget/calendar';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { unstable_useId as useId } from '@mui/utils';
import { DateTime } from 'luxon';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarFilters,
  calendarEventKey,
  calendarEventToFullCalendarEvent,
} from '../../calendar';
import { CalendarViewType } from '../../lib/utils';
import { FullCalendarThemeProvider } from '../meetings/MeetingsCalendar/FullCalendarThemeProvider';
import {
  dayGridPlugin,
  interactionPlugin,
  timeGridPlugin,
} from '../meetings/MeetingsCalendar/plugins';
import { formatCalendarEventTime } from './CalendarEventDetailsDialog';

export function CalendarEventsCalendar({
  events,
  filters,
  onSelectEvent,
  onShowMore,
  view,
}: {
  events: CalendarEvent[];
  filters: CalendarFilters;
  onSelectEvent: (event: CalendarEvent) => void;
  onShowMore: (date: Date) => void;
  view: CalendarViewType;
}) {
  const { i18n } = useTranslation();
  const language = i18n.languages?.[0];
  const locale =
    language && new Intl.Locale(language).language === 'de'
      ? deLocale
      : undefined;
  const ref = useRef<FullCalendar>(null);
  const buttonsId = useId();

  const eventMap = useMemo(
    () => new Map(events.map((event) => [calendarEventKey(event), event])),
    [events],
  );

  const fullCalendarEvents = useMemo(
    () =>
      events.map((event) =>
        calendarEventToFullCalendarEvent(
          event,
          `${buttonsId}-${normalizeId(calendarEventKey(event))}`,
        ),
      ),
    [buttonsId, events],
  );

  useEffect(() => {
    const fullCalendar = ref.current;
    if (fullCalendar) {
      fullCalendar
        .getApi()
        .changeView(fullcalendarViewType(view), filters.startDate);
    }
  }, [filters.startDate, view]);

  const handleEventDidMount = useCallback((arg: EventMountArg) => {
    const buttonLabelId: string = arg.event.extendedProps['buttonLabelId'];
    arg.el.setAttribute('role', 'button');
    arg.el.setAttribute('aria-labelledby', buttonLabelId);
  }, []);

  const renderEventContent = useCallback(
    (arg: EventContentArg) => {
      const event = eventMap.get(arg.event.id);
      if (!event) {
        return <>{arg.event.title}</>;
      }

      return (
        <CalendarEventCell
          buttonLabelId={arg.event.extendedProps['buttonLabelId']}
          event={event}
          view={view}
        />
      );
    },
    [eventMap, view],
  );

  const handleEventClick = useCallback(
    (arg: EventClickArg) => {
      const event = eventMap.get(arg.event.id);
      if (event) {
        onSelectEvent(event);
      }
    },
    [eventMap, onSelectEvent],
  );

  const handleMoreLinkDidMount = useCallback((arg: MoreLinkMountArg) => {
    arg.el.setAttribute('role', 'button');
    arg.el.removeAttribute('aria-controls');
    arg.el.removeAttribute('aria-expanded');
  }, []);

  const handleMoreLinkClick = useCallback(
    (arg: MoreLinkArg): MoreLinkSimpleAction => {
      onShowMore(arg.date);
      return 'stop';
    },
    [onShowMore],
  );

  return (
    <FullCalendarThemeProvider>
      <FullCalendar
        allDaySlot
        dayMaxEventRows={3}
        eventClick={handleEventClick}
        eventContent={renderEventContent}
        eventDidMount={handleEventDidMount}
        eventDisplay="block"
        eventInteractive
        eventMinHeight={22}
        events={fullCalendarEvents}
        fixedWeekCount={false}
        headerToolbar={false}
        height="100%"
        locale={locale}
        moreLinkClick={handleMoreLinkClick}
        moreLinkDidMount={handleMoreLinkDidMount}
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
        ref={ref}
        scrollTime="08:00:00"
        slotEventOverlap={false}
        weekends={view !== 'workWeek'}
      />
    </FullCalendarThemeProvider>
  );
}

function CalendarEventCell({
  buttonLabelId,
  event,
  view,
}: {
  buttonLabelId: string;
  event: CalendarEvent;
  view: CalendarViewType;
}) {
  const { i18n, t } = useTranslation();
  const recurring = Boolean(
    event.recurrence?.rrule ||
      event.recurrence?.rdates?.length ||
      event.recurrence?.recurrenceId,
  );
  const label = `${event.title}: ${formatCalendarEventTime(
    event,
    i18n.language,
    t('calendarEvents.details.allDay', 'All day'),
  )}`;

  return (
    <>
      <Tooltip title={<>{label}</>}>
        <Box height="100%">
          <Stack flexDirection="row" height="100%">
            <Box
              flex="1"
              maxWidth="100%"
              overflow="hidden"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
            >
              {view === 'month' && !isAllDayCalendarEvent(event) && (
                <Typography component="span" variant="body2">
                  {DateTime.fromISO(event.timing.start.local, {
                    zone: event.timing.start.timezone,
                  }).toLocaleString(DateTime.TIME_SIMPLE)}{' '}
                </Typography>
              )}
              <Typography component="span" fontWeight="bold" variant="body2">
                {event.title}
              </Typography>
            </Box>
            {recurring && (
              <Box display="flex" marginLeft="auto">
                <EventRepeatIcon fontSize="inherit" />
              </Box>
            )}
          </Stack>
        </Box>
      </Tooltip>

      <Box display="none" id={buttonLabelId}>
        {label}
      </Box>
    </>
  );
}

function fullcalendarViewType(view: CalendarViewType): string {
  switch (view) {
    case 'day':
      return 'timeGridDay';
    case 'workWeek':
    case 'week':
      return 'timeGridWeek';
    case 'month':
      return 'dayGridMonth';
  }
}

function normalizeId(input: string): string {
  return input.replace(/[^A-Z0-9_-]/gi, '');
}
