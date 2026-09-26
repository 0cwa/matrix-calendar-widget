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
  calendarEventDateTimeForDisplay,
  CalendarEventPresentation,
  useCalendarRepository,
  useCalendars,
  useCancelCalendarOccurrence,
  useDeleteCalendarEvent,
} from '../../calendar';
import { ConfirmDeleteDialog } from '../common/ConfirmDeleteDialog';
import { CalendarEventEditorDialog } from './CalendarEventEditorDialog';

export function CalendarEventDetailsDialog({
  event,
  roomContext = false,
  onClose,
}: {
  event?: CalendarEventPresentation;
  roomContext?: boolean;
  onClose: () => void;
}) {
  const { i18n, t } = useTranslation();
  const calendars = useCalendars();
  const repository = useCalendarRepository();
  const deleteEvent = useDeleteCalendarEvent();
  const cancelOccurrence = useCancelCalendarOccurrence();
  const [currentSelection, setCurrentSelection] = useState(event);
  const [editing, setEditing] = useState(false);
  const [followingEditing, setFollowingEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState<
    'conflict' | 'generic' | undefined
  >();
  const [deleteError, setDeleteError] = useState<
    'conflict' | 'generic' | undefined
  >();

  useEffect(() => {
    setCurrentSelection(event);
    setEditing(false);
    setFollowingEditing(false);
    setDeleteOpen(false);
    setDeleteLoading(false);
    setCancelOpen(false);
    setCancelLoading(false);
    setCancelError(undefined);
    setDeleteError(undefined);
  }, [event]);

  const currentEvent = currentSelection?.event;
  const resourceEvent = currentSelection?.resourceEvent;
  const recurringOccurrence = currentSelection?.recurrenceId !== undefined;
  const rangeBoundary = Boolean(
    resourceEvent?.recurrence?.overrides?.some(
      (override) =>
        override.range === 'this-and-following' &&
        currentSelection?.recurrenceId &&
        sameRecurrenceIdentity(
          override.recurrenceId,
          currentSelection.recurrenceId,
        ),
    ),
  );
  const eventCalendar = currentEvent
    ? calendars.data.find((calendar) => calendar.id === currentEvent.calendarId)
    : undefined;
  const canMutate = Boolean(
    eventCalendar &&
    !eventCalendar.readOnly &&
    resourceEvent &&
    (!recurringOccurrence || currentSelection?.recurrenceId),
  );

  const handleDelete = async () => {
    if (
      !currentSelection ||
      recurringOccurrence ||
      !resourceEvent ||
      !canMutate
    ) {
      return;
    }

    setDeleteLoading(true);
    setDeleteError(undefined);

    try {
      await deleteEvent(resourceEvent.calendarId, resourceEvent.id);
      setDeleteOpen(false);
      onClose();
    } catch (error) {
      if (
        error instanceof CalendarRepositoryError &&
        error.code === 'event-conflict'
      ) {
        try {
          const latest = await repository.getEvent(
            resourceEvent.calendarId,
            resourceEvent.id,
          );
          setCurrentSelection({
            ...currentSelection,
            event: latest,
            resourceEvent: latest,
          });
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

  const handleCancelOccurrence = async () => {
    if (!currentSelection?.recurrenceId || !resourceEvent || !canMutate) {
      return;
    }

    setCancelLoading(true);
    setCancelError(undefined);
    try {
      await cancelOccurrence(
        resourceEvent.calendarId,
        resourceEvent.id,
        currentSelection.recurrenceId,
      );
      setCancelOpen(false);
      onClose();
    } catch (error) {
      const conflict =
        error instanceof CalendarRepositoryError &&
        error.code === 'event-conflict';
      setCancelError(conflict ? 'conflict' : 'generic');
      if (conflict) setCancelOpen(false);
    } finally {
      setCancelLoading(false);
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

                {recurringOccurrence && (
                  <Alert severity="info">
                    {rangeBoundary
                      ? t(
                          'calendarEvents.details.rangeBoundaryActionsAvailable',
                          'This is the start of a following-scope change. Edit or cancel only this occurrence is unavailable; you can update this and later occurrences.',
                        )
                      : t(
                          'calendarEvents.details.occurrenceActionsAvailable',
                          'Changes here apply to this occurrence only. Other events in the series remain unchanged.',
                        )}
                  </Alert>
                )}
                {cancelError === 'conflict' && (
                  <Alert severity="warning">
                    {t(
                      'calendarEvents.details.occurrenceConflict',
                      'This series changed elsewhere. Close and reopen this occurrence before trying again.',
                    )}
                  </Alert>
                )}

                <Typography>
                  {formatCalendarEventTime(
                    currentEvent,
                    i18n.language,
                    t('calendarEvents.details.allDay', 'All day'),
                    currentSelection?.rangeTimezone,
                    currentSelection?.viewerTimezone,
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
              {recurringOccurrence ? (
                <>
                  <Button
                    disabled={!canMutate || rangeBoundary}
                    onClick={() => {
                      setFollowingEditing(false);
                      setEditing(true);
                    }}
                  >
                    {t(
                      'calendarEvents.details.editThisOccurrence',
                      'Edit this event',
                    )}
                  </Button>
                  <Button
                    color="error"
                    disabled={
                      !canMutate || rangeBoundary || cancelError === 'conflict'
                    }
                    onClick={() => {
                      setCancelError(undefined);
                      setCancelOpen(true);
                    }}
                  >
                    {t(
                      'calendarEvents.details.cancelThisOccurrence',
                      'Cancel this event',
                    )}
                  </Button>
                  <Button
                    disabled={!canMutate}
                    onClick={() => {
                      setFollowingEditing(true);
                      setEditing(true);
                    }}
                  >
                    {t(
                      'calendarEvents.details.editThisAndFollowing',
                      'Edit this and following',
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    disabled={!canMutate}
                    onClick={() => {
                      setFollowingEditing(false);
                      setEditing(true);
                    }}
                  >
                    {t('calendarEvents.details.edit', 'Edit')}
                  </Button>
                  <Button
                    color="error"
                    disabled={!canMutate}
                    onClick={() => setDeleteOpen(true)}
                  >
                    {t('calendarEvents.details.delete', 'Delete')}
                  </Button>
                </>
              )}
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
          occurrenceTarget={
            !followingEditing && currentSelection?.recurrenceId && resourceEvent
              ? {
                  resourceEventId: resourceEvent.id,
                  recurrenceId: currentSelection.recurrenceId,
                }
              : undefined
          }
          followingTarget={
            followingEditing && currentSelection?.recurrenceId && resourceEvent
              ? {
                  resourceEventId: resourceEvent.id,
                  recurrenceId: currentSelection.recurrenceId,
                }
              : undefined
          }
          onClose={() => {
            setEditing(false);
            setFollowingEditing(false);
          }}
          onSaved={(savedEvent) => {
            if (currentSelection?.recurrenceId) {
              onClose();
              return;
            }
            setCurrentSelection((current) =>
              current
                ? {
                    ...current,
                    event: savedEvent,
                    resourceEvent: savedEvent,
                  }
                : current,
            );
          }}
          open={editing}
          roomContext={roomContext}
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

      {currentEvent && (
        <ConfirmDeleteDialog
          confirmTitle={t(
            'calendarEvents.details.cancelOccurrenceConfirm',
            'Cancel this event',
          )}
          description={t(
            'calendarEvents.details.cancelOccurrenceDescription',
            'Cancel only this occurrence of “{{title}}”? The series and other occurrences will remain.',
            { title: currentEvent.title },
          )}
          loading={cancelLoading}
          onCancel={() => {
            setCancelOpen(false);
            setCancelError(undefined);
          }}
          onConfirm={handleCancelOccurrence}
          open={cancelOpen}
          title={t(
            'calendarEvents.details.cancelOccurrenceTitle',
            'Cancel recurring occurrence',
          )}
        >
          {cancelError === 'generic' && (
            <Alert severity="error">
              {t(
                'calendarEvents.details.occurrenceCancelError',
                'This occurrence could not be cancelled.',
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
  rangeTimezone?: string,
  viewerTimezone?: string,
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

  const start = calendarEventDateTimeForDisplay(
    event.timing.start,
    rangeTimezone,
    viewerTimezone,
  ).setLocale(locale);
  const end = calendarEventDateTimeForDisplay(
    event.timing.end,
    rangeTimezone,
    viewerTimezone,
  ).setLocale(locale);

  if (start.hasSame(end, 'day')) {
    return `${start.toLocaleString(DateTime.DATE_FULL)} · ${start.toLocaleString(
      DateTime.TIME_SIMPLE,
    )}–${end.toLocaleString(DateTime.TIME_SIMPLE)}`;
  }

  return `${start.toLocaleString(DateTime.DATETIME_MED)} – ${end.toLocaleString(
    DateTime.DATETIME_MED,
  )}`;
}

function sameRecurrenceIdentity(
  left: CalendarEventDateTime,
  right: CalendarEventDateTime,
): boolean {
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === 'date' && right.type === 'date') {
    return left.value === right.value;
  }
  return (
    left.type === 'date-time' &&
    right.type === 'date-time' &&
    left.value.local === right.value.local &&
    left.value.timezone === right.value.timezone &&
    (left.value.mode ?? 'tzid') === (right.value.mode ?? 'tzid')
  );
}
