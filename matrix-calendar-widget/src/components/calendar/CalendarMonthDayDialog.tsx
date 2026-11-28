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
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemButton,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { calendarEventKey } from '../../calendar';
import { CalendarColorDot, EventCalendarIdentity } from './CalendarColorDot';

export type CalendarMonthDayEntry = {
  event: CalendarEvent;
  calendar?: EventCalendarIdentity;
  /** The full date and time of the event, in the viewer's time zone. */
  time: string;
  /** The same accessible name that the event has in the grid. */
  label: string;
};

/**
 * All events of one Month date, for the dates that have more events than the
 * grid can show. Event details open above this dialog, so closing them returns
 * to the same event.
 */
export function CalendarMonthDayDialog({
  date,
  entries,
  onClose,
  onOpenDay,
  onSelectEvent,
  open,
}: {
  /** Local midnight of the date, as FullCalendar reports it. */
  date: Date;
  entries: CalendarMonthDayEntry[];
  onClose: () => void;
  onOpenDay: () => void;
  onSelectEvent: (event: CalendarEvent) => void;
  open: boolean;
}) {
  const { i18n, t } = useTranslation();
  const theme = useTheme();
  const title = DateTime.local(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  )
    .setLocale(i18n.language)
    .toLocaleString(DateTime.DATE_HUGE);

  return (
    <Dialog fullWidth maxWidth="xs" onClose={onClose} open={open}>
      <DialogTitle>{title}</DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        <List disablePadding>
          {entries.map(({ event, calendar, time, label }, index) => (
            <ListItem disablePadding key={calendarEventKey(event)}>
              <ListItemButton
                aria-label={label}
                autoFocus={index === 0}
                onClick={() => onSelectEvent(event)}
                sx={{ overflowWrap: 'anywhere', px: 3 }}
              >
                <Box minWidth={0}>
                  <Typography fontWeight="bold">{event.title}</Typography>
                  <Typography color="text.secondary" variant="body2">
                    {time}
                  </Typography>
                  {calendar && (
                    <Stack alignItems="center" direction="row" spacing={1}>
                      {calendar.color && (
                        <CalendarColorDot
                          color={calendar.color}
                          ringColor={theme.palette.text.secondary}
                        />
                      )}
                      <Typography color="text.secondary" variant="body2">
                        {calendar.name}
                      </Typography>
                    </Stack>
                  )}
                </Box>
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </DialogContent>

      <DialogActions sx={{ flexWrap: 'wrap', px: 3, py: 2 }}>
        <Button onClick={onClose}>
          {t('calendarEvents.details.close', 'Close')}
        </Button>
        <Button onClick={onOpenDay} variant="contained">
          {t('calendarEvents.monthDay.openDay', 'Open day')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
