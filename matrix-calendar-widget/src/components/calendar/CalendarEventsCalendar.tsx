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
  Calendar,
  CalendarEvent,
  calendarEventTimedDateTimeToDateTime,
  isTimedCalendarEvent,
} from '@matrix-calendar-widget/calendar';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import { Box, Stack, Tooltip, Typography, useTheme } from '@mui/material';
import { unstable_useId as useId } from '@mui/utils';
import { DateTime } from 'luxon';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarFilters,
  calendarEventKey,
  calendarEventToFullCalendarEvent,
} from '../../calendar';
import { CalendarViewType } from '../../lib/utils';
import {
  CalendarColorDot,
  EventCalendarIdentity,
  eventCalendarIdentities,
} from './CalendarColorDot';
import { formatCalendarEventTime } from './CalendarEventDetailsDialog';
import { CalendarMonthDayDialog } from './CalendarMonthDayDialog';
import { FullCalendarThemeProvider } from './FullCalendar/FullCalendarThemeProvider';
import {
  dayGridPlugin,
  interactionPlugin,
  timeGridPlugin,
} from './FullCalendar/plugins';

export function CalendarEventsCalendar({
  calendars,
  events,
  filters,
  onSelectEvent,
  onShowMore,
  view,
}: {
  calendars?: Calendar[];
  events: CalendarEvent[];
  filters: CalendarFilters;
  onSelectEvent: (event: CalendarEvent) => void;
  onShowMore: (date: Date) => void;
  view: CalendarViewType;
}) {
  const { i18n, t } = useTranslation();
  const language = i18n.languages?.[0];
  const locale =
    language && new Intl.Locale(language).language === 'de'
      ? deLocale
      : undefined;
  const ref = useRef<FullCalendar>(null);
  const buttonsId = useId();
  const viewerTimezone = DateTime.local().zoneName ?? 'UTC';

  const eventMap = useMemo(
    () => new Map(events.map((event) => [calendarEventKey(event), event])),
    [events],
  );

  const identities = useMemo(
    () => eventCalendarIdentities(calendars ?? []),
    [calendars],
  );

  const fullCalendarEvents = useMemo(
    () =>
      events.map((event) =>
        calendarEventToFullCalendarEvent(
          event,
          `${buttonsId}-${normalizeId(calendarEventKey(event))}`,
          viewerTimezone,
        ),
      ),
    [buttonsId, events, viewerTimezone],
  );

  // The Month date whose full event list was requested last.
  const [dayList, setDayList] = useState<{
    date: Date;
    eventKeys: string[];
    open: boolean;
  }>();
  const closeDayList = useCallback(
    () => setDayList((current) => current && { ...current, open: false }),
    [],
  );

  useEffect(() => {
    closeDayList();
  }, [closeDayList, filters.startDate, view]);

  useEffect(() => {
    const fullCalendar = ref.current;
    if (fullCalendar) {
      fullCalendar
        .getApi()
        .changeView(fullCalendarViewType(view), filters.startDate);
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
          calendar={identities.get(event.calendarId)}
          event={event}
          startsHere={arg.isStart}
          viewerTimezone={viewerTimezone}
          view={view}
        />
      );
    },
    [eventMap, identities, viewerTimezone, view],
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
    if (arg.view.type === 'dayGridMonth') {
      arg.el.setAttribute('aria-haspopup', 'dialog');
    }
  }, []);

  const handleMoreLinkClick = useCallback(
    (arg: MoreLinkArg): MoreLinkSimpleAction => {
      // FullCalendar 6.1 passes the calendar day as a UTC marker to moreLinkClick.
      // Convert it to local midnight before handing it to the date controls.
      const date = new Date(
        arg.date.getUTCFullYear(),
        arg.date.getUTCMonth(),
        arg.date.getUTCDate(),
      );

      if (arg.view.type !== 'dayGridMonth') {
        onShowMore(date);
        return 'stop';
      }

      // Not every browser focuses a clicked link, and the list returns focus
      // to whatever had it when it opened.
      (arg.jsEvent.target as Element)
        .closest<HTMLElement>('.fc-daygrid-more-link')
        ?.focus();
      setDayList({
        date,
        eventKeys: arg.allSegs.map((segment) => segment.event.id),
        open: true,
      });
      // FullCalendar opens its own popover for a falsy result and moves to the
      // clicked date for any string, which can change the month. Any other
      // value leaves the grid as it is, but the type doesn't offer one.
      return true as unknown as MoreLinkSimpleAction;
    },
    [onShowMore],
  );

  const dayListEntries = (dayList?.eventKeys ?? []).flatMap((key) => {
    const event = eventMap.get(key);
    if (!event) {
      return [];
    }

    const calendar = identities.get(event.calendarId);
    const time = formatCalendarEventTime(
      event,
      i18n.language,
      t('calendarEvents.details.allDay', 'All day'),
      viewerTimezone,
    );
    return [{ event, calendar, time }];
  });

  return (
    <FullCalendarThemeProvider>
      <FullCalendar
        allDaySlot
        dayMaxEventRows={3}
        eventClassNames={(arg) => {
          const event = eventMap.get(arg.event.id);
          return view === 'month' &&
            event &&
            isSingleDayTimed(event, viewerTimezone)
            ? ['mcw-month-timed']
            : [];
        }}
        eventClick={handleEventClick}
        eventContent={renderEventContent}
        eventDidMount={handleEventDidMount}
        eventDisplay="block"
        eventInteractive
        expandRows={view === 'month'}
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
      {dayList && (
        <CalendarMonthDayDialog
          date={dayList.date}
          entries={dayListEntries}
          onClose={closeDayList}
          onOpenDay={() => {
            closeDayList();
            onShowMore(dayList.date);
          }}
          onSelectEvent={onSelectEvent}
          open={dayList.open && view === 'month'}
          viewerTimezone={viewerTimezone}
        />
      )}
    </FullCalendarThemeProvider>
  );
}

function CalendarEventCell({
  buttonLabelId,
  calendar,
  event,
  startsHere,
  viewerTimezone,
  view,
}: {
  buttonLabelId: string;
  calendar?: EventCalendarIdentity;
  event: CalendarEvent;
  startsHere: boolean;
  viewerTimezone: string;
  view: CalendarViewType;
}) {
  const { i18n, t } = useTranslation();
  const theme = useTheme();
  const { ref, ...tooltipState } = useEventTooltip();
  const textLineHeight = `${theme.typography.body2.lineHeight}em`;
  const recurring = Boolean(
    event.recurrence?.rrule ||
    event.recurrence?.rdates?.length ||
    event.recurrence?.recurrenceId,
  );
  const time = formatCalendarEventTime(
    event,
    i18n.language,
    t('calendarEvents.details.allDay', 'All day'),
    viewerTimezone,
  );
  const label = eventLabel(event, time, calendar);
  const monthStartTime =
    view === 'month' && startsHere && isTimedCalendarEvent(event)
      ? calendarEventTimedDateTimeToDateTime(event.timing.start, viewerTimezone)
          .setLocale(i18n.language)
          .toLocaleString(DateTime.TIME_SIMPLE)
      : undefined;
  const accessibleLabel = monthStartTime ? `${monthStartTime} ${label}` : label;
  const lightweight =
    view === 'month' && isSingleDayTimed(event, viewerTimezone);
  const title = (
    <Typography
      component="span"
      fontWeight={lightweight ? 600 : 700}
      maxWidth="100%"
      minWidth={0}
      noWrap={view === 'month'}
      variant="body2"
    >
      {event.title}
    </Typography>
  );

  return (
    <>
      <Tooltip {...tooltipState} title={<>{label}</>}>
        <Box height="100%" ref={ref}>
          <Stack flexDirection="row" height="100%">
            {(calendar?.color || lightweight) && (
              // The height of one text line, so the dot centers on the title.
              <Box
                alignItems="center"
                display="flex"
                fontSize={theme.typography.body2.fontSize}
                height={textLineHeight}
                px="3px"
              >
                <CalendarColorDot
                  color={calendar?.color ?? theme.palette.primary.main}
                  ringColor={
                    lightweight
                      ? theme.palette.background.default
                      : theme.palette.primary.contrastText
                  }
                />
              </Box>
            )}
            <Box
              flex="1"
              maxWidth="100%"
              minWidth={0}
              overflow="hidden"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
            >
              {view === 'month' ? (
                <Box display="flex" alignItems="center" gap={0.5} minWidth={0}>
                  {monthStartTime && (
                    <Typography
                      component="span"
                      data-testid="month-event-start-time"
                      variant="caption"
                      sx={{
                        color: lightweight ? 'text.secondary' : 'inherit',
                        flexShrink: 0,
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1.2,
                      }}
                    >
                      {monthStartTime}
                    </Typography>
                  )}
                  {title}
                </Box>
              ) : (
                title
              )}
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
        {accessibleLabel}
      </Box>
    </>
  );
}

function eventLabel(
  event: CalendarEvent,
  time: string,
  calendar?: EventCalendarIdentity,
): string {
  return calendar
    ? `${event.title}: ${time} · ${calendar.name}`
    : `${event.title}: ${time}`;
}

/**
 * FullCalendar owns the focusable event element around the cell content, so the
 * tooltip has to follow that element to show keyboard users the full title.
 */
function useEventTooltip() {
  const [open, setOpen] = useState(false);
  const [element, ref] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const eventElement = element?.closest<HTMLElement>('.fc-event');
    if (!eventElement) {
      return undefined;
    }

    const handleFocus = () => {
      if (eventElement.matches(':focus-visible')) {
        setOpen(true);
      }
    };
    const handleBlur = () => setOpen(false);
    eventElement.addEventListener('focus', handleFocus);
    eventElement.addEventListener('blur', handleBlur);

    return () => {
      eventElement.removeEventListener('focus', handleFocus);
      eventElement.removeEventListener('blur', handleBlur);
    };
  }, [element]);

  return {
    ref,
    open,
    onOpen: () => setOpen(true),
    onClose: () => setOpen(false),
  };
}

function fullCalendarViewType(view: CalendarViewType): string {
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

function isSingleDayTimed(event: CalendarEvent, zone: string): boolean {
  if (!isTimedCalendarEvent(event)) return false;
  const start = calendarEventTimedDateTimeToDateTime(event.timing.start, zone);
  const end = calendarEventTimedDateTimeToDateTime(event.timing.end, zone);
  return start.toISODate() === end.toISODate();
}
