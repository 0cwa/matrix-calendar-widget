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
  CalendarRepositoryError,
  isAllDayCalendarEvent,
  isTimedCalendarEvent,
} from '@matrix-calendar-widget/calendar';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCalendarRepository,
  useCalendars,
  useDeleteCalendarEvent,
} from '../../calendar';
import { ConfirmDeleteDialog } from '../common/ConfirmDeleteDialog';
import { CalendarEventEditorDialog } from './CalendarEventEditorDialog';

export function CalendarEventDetailsDialog({
  event,
  onClose,
}: {
  event?: CalendarEvent;
  onClose: () => void;
}) {
  const { i18n, t } = useTranslation();
  const calendars = useCalendars();
  const repository = useCalendarRepository();
  const deleteEvent = useDeleteCalendarEvent();
  const [currentEvent, setCurrentEvent] = useState(event);
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<
    'conflict' | 'generic' | undefined
  >();

  useEffect(() => {
    setCurrentEvent(event);
    setEditing(false);
    setDeleteOpen(false);
    setDeleteLoading(false);
    setDeleteError(undefined);
  }, [event]);

  const eventCalendar = currentEvent
    ? calendars.data.find((calendar) => calendar.id === currentEvent.calendarId)
    : undefined;
  const canMutate = Boolean(eventCalendar && !eventCalendar.readOnly);

  const handleDelete = async () => {
    if (!currentEvent || !canMutate) {
      return;
    }

    setDeleteLoading(true);
    setDeleteError(undefined);

    try {
      await deleteEvent(currentEvent.calendarId, currentEvent.id);
      setDeleteOpen(false);
      onClose();
    } catch (error) {
      if (
        error instanceof CalendarRepositoryError &&
        error.code === 'event-conflict'
      ) {
        try {
          const latest = await repository.getEvent(
            currentEvent.calendarId,
            currentEvent.id,
          );
          setCurrentEvent(latest);
          setDeleteError('conflict');
        } catch {
          setDeleteError('generic');
        }
      } else {
        setDeleteError('generic');
      }
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <>
      <Dialog
        fullWidth
        maxWidth="sm"
        onClose={onClose}
        open={Boolean(currentEvent) && !editing}
      >
        {currentEvent && (
          <>
            <DialogTitle>{currentEvent.title}</DialogTitle>
            <DialogContent>
              <Stack spacing={1}>
                {eventCalendar?.readOnly && (
                  <Alert severity="info">
                    {t(
                      'calendarEvents.editor.readOnly',
                      'This calendar is read-only.',
                    )}
                  </Alert>
                )}

                <Typography>
                  {formatCalendarEventTime(
                    currentEvent,
                    i18n.language,
                    t('calendarEvents.details.allDay', 'All day'),
                  )}
                </Typography>

                {currentEvent.location && (
                  <Typography>
                    {t('calendarEvents.details.location', 'Location')}:{' '}
                    {currentEvent.location}
                  </Typography>
                )}

                {currentEvent.description && (
                  <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                    {currentEvent.description}
                  </Typography>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button disabled={!canMutate} onClick={() => setEditing(true)}>
                {t('calendarEvents.details.edit', 'Edit')}
              </Button>
              <Button
                color="error"
                disabled={!canMutate}
                onClick={() => setDeleteOpen(true)}
              >
                {t('calendarEvents.details.delete', 'Delete')}
              </Button>
              <Button onClick={onClose}>
                {t('calendarEvents.details.close', 'Close')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {currentEvent && (
        <CalendarEventEditorDialog
          calendars={calendars.data}
          event={currentEvent}
          onClose={() => setEditing(false)}
          onSaved={setCurrentEvent}
          open={editing}
        />
      )}

      {currentEvent && (
        <ConfirmDeleteDialog
          confirmTitle={t('calendarEvents.delete.confirm', 'Delete')}
          description={t(
            'calendarEvents.delete.description',
            'Delete “{{title}}”? This cannot be undone.',
            { title: currentEvent.title },
          )}
          loading={deleteLoading}
          onCancel={() => {
            setDeleteOpen(false);
            setDeleteError(undefined);
          }}
          onConfirm={handleDelete}
          open={deleteOpen}
          title={t('calendarEvents.delete.title', 'Delete event')}
        >
          {deleteError && (
            <Alert severity={deleteError === 'conflict' ? 'warning' : 'error'}>
              {deleteError === 'conflict'
                ? t(
                    'calendarEvents.delete.conflict',
                    'This event changed elsewhere. The latest version was reloaded; review it and retry if you still want to delete it.',
                  )
                : t(
                    'calendarEvents.delete.error',
                    'The event could not be deleted.',
                  )}
            </Alert>
          )}
        </ConfirmDeleteDialog>
      )}
    </>
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

  if (!isTimedCalendarEvent(event)) {
    return '';
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
