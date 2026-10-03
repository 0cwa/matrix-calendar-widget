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
  boundCalendarEventExternalLinkLabel,
  CalendarEvent,
  CalendarEventDateTime,
  CalendarEventExternalLink,
  calendarEventRecurrenceIdentity,
  calendarEventTimedDateTimeToDateTime,
  CalendarRepositoryError,
  canonicalizeCalendarExternalUrl,
  isAllDayCalendarEvent,
  isSupportedCalendarEventOccurrenceExclusion,
  isTimedCalendarEvent,
  MAX_CALENDAR_EVENT_EXTERNAL_LINKS,
} from '@matrix-calendar-widget/calendar';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
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
  useUpdateCalendarEvent,
} from '../../calendar';
import { ConfirmDeleteDialog } from '../common/ConfirmDeleteDialog';
import { CalendarEventEditorDialog } from './CalendarEventEditorDialog';

export function CalendarEventDetailsDialog({
  event,
  sourceEvent = event,
  recurrenceId,
  onSourceEventChange,
  onClose,
}: {
  event?: CalendarEvent;
  /** The CalDAV resource used for series-level reads and mutations. */
  sourceEvent?: CalendarEvent;
  /** Original recurrence identity for the selected projected occurrence. */
  recurrenceId?: CalendarEventDateTime;
  onSourceEventChange?: (sourceEvent: CalendarEvent) => void;
  onClose: () => void;
}) {
  const { i18n, t } = useTranslation();
  const calendars = useCalendars();
  const repository = useCalendarRepository();
  const deleteEvent = useDeleteCalendarEvent();
  const updateEvent = useUpdateCalendarEvent();
  const [currentEvent, setCurrentEvent] = useState(event);
  const [currentSourceEvent, setCurrentSourceEvent] = useState(sourceEvent);
  const [currentRecurrenceId, setCurrentRecurrenceId] = useState(recurrenceId);
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<
    'conflict' | 'generic' | undefined
  >();
  const [occurrenceLoading, setOccurrenceLoading] = useState(false);
  const [occurrenceError, setOccurrenceError] = useState<
    'conflict' | 'generic' | undefined
  >();

  useEffect(() => {
    setCurrentEvent(event);
    setCurrentSourceEvent(sourceEvent);
    setCurrentRecurrenceId(recurrenceId);
    setEditing(false);
    setDeleteOpen(false);
    setDeleteLoading(false);
    setDeleteError(undefined);
    setOccurrenceLoading(false);
    setOccurrenceError(undefined);
  }, [event, recurrenceId, sourceEvent]);

  const eventCalendar = currentSourceEvent
    ? calendars.data.find(
        (calendar) => calendar.id === currentSourceEvent.calendarId,
      )
    : undefined;
  const canMutate = Boolean(eventCalendar && !eventCalendar.readOnly);
  const deletesRecurringSeries = Boolean(
    currentSourceEvent?.recurrence?.rrule ||
    currentSourceEvent?.recurrence?.rdates?.length ||
    currentSourceEvent?.recurrence?.exdates?.length ||
    currentSourceEvent?.recurrence?.overrides?.length,
  );
  const canChangeCurrentOccurrence = Boolean(
    canMutate &&
    currentRecurrenceId &&
    currentSourceEvent &&
    isSupportedCalendarEventOccurrenceExclusion(
      currentSourceEvent,
      currentRecurrenceId,
    ),
  );
  const currentOccurrenceExcluded = Boolean(
    canChangeCurrentOccurrence &&
    currentRecurrenceId &&
    currentSourceEvent?.recurrence?.exdates?.some(
      (exdate) =>
        calendarEventRecurrenceIdentity(exdate) ===
        calendarEventRecurrenceIdentity(currentRecurrenceId),
    ),
  );
  const otherSkippedOccurrences =
    canChangeCurrentOccurrence && currentRecurrenceId
      ? uniqueRecurrenceIds(
          currentSourceEvent?.recurrence?.exdates ?? [],
        ).filter(
          (exdate) =>
            calendarEventRecurrenceIdentity(exdate) !==
            calendarEventRecurrenceIdentity(currentRecurrenceId),
        )
      : [];
  const visibleExternalLinks = currentEvent
    ? getVisibleCalendarExternalLinks(currentEvent, t)
    : [];

  const changeOccurrenceException = async (
    action: 'add' | 'remove',
    targetRecurrenceId: CalendarEventDateTime,
  ) => {
    if (!currentSourceEvent || !canMutate) {
      return;
    }

    setOccurrenceLoading(true);
    setOccurrenceError(undefined);
    try {
      const updated = await updateEvent(
        currentSourceEvent.calendarId,
        currentSourceEvent.id,
        {
          recurrence: {
            exdate: { action, recurrenceId: targetRecurrenceId },
          },
        },
      );
      setCurrentSourceEvent(updated);
      onSourceEventChange?.(updated);
    } catch (error) {
      setOccurrenceError(
        error instanceof CalendarRepositoryError &&
          error.code === 'event-conflict'
          ? 'conflict'
          : 'generic',
      );
    } finally {
      setOccurrenceLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!currentEvent || !currentSourceEvent || !canMutate) {
      return;
    }

    setDeleteLoading(true);
    setDeleteError(undefined);

    try {
      await deleteEvent(currentSourceEvent.calendarId, currentSourceEvent.id);
      setDeleteOpen(false);
      onClose();
    } catch (error) {
      if (
        error instanceof CalendarRepositoryError &&
        error.code === 'event-conflict'
      ) {
        try {
          const latest = await repository.getEvent(
            currentSourceEvent.calendarId,
            currentSourceEvent.id,
          );
          setCurrentEvent(latest);
          setCurrentSourceEvent(latest);
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

                {currentEvent.id !== currentSourceEvent?.id &&
                  deletesRecurringSeries && (
                    <Alert severity="info">
                      {t(
                        'calendarEvents.details.seriesOccurrenceActions',
                        'This is one occurrence of a recurring series. Editing or deleting applies to the whole series.',
                      )}
                    </Alert>
                  )}

                {canChangeCurrentOccurrence && currentRecurrenceId && (
                  <Stack spacing={1}>
                    <Button
                      disabled={occurrenceLoading}
                      onClick={() =>
                        void changeOccurrenceException(
                          currentOccurrenceExcluded ? 'remove' : 'add',
                          currentRecurrenceId,
                        )
                      }
                    >
                      {currentOccurrenceExcluded
                        ? t(
                            'calendarEvents.details.restoreOccurrence',
                            'Restore this occurrence',
                          )
                        : t(
                            'calendarEvents.details.skipOccurrence',
                            'Skip this occurrence',
                          )}
                    </Button>

                    {otherSkippedOccurrences.length > 0 && (
                      <Stack spacing={0.5}>
                        <Typography>
                          {t(
                            'calendarEvents.details.skippedOccurrences',
                            'Skipped occurrences',
                          )}
                        </Typography>
                        {otherSkippedOccurrences.map((exdate) => (
                          <Stack
                            alignItems="center"
                            direction="row"
                            key={calendarEventRecurrenceIdentity(exdate)}
                            justifyContent="space-between"
                          >
                            <Typography>
                              {formatRecurrenceIdentity(exdate, i18n.language)}
                            </Typography>
                            <Button
                              disabled={occurrenceLoading}
                              onClick={() =>
                                void changeOccurrenceException('remove', exdate)
                              }
                            >
                              {t(
                                'calendarEvents.details.restoreSkippedOccurrence',
                                'Restore',
                              )}
                            </Button>
                          </Stack>
                        ))}
                      </Stack>
                    )}

                    {occurrenceError && (
                      <Alert
                        severity={
                          occurrenceError === 'conflict' ? 'warning' : 'error'
                        }
                      >
                        {occurrenceError === 'conflict'
                          ? t(
                              'calendarEvents.details.occurrenceConflict',
                              'This event changed elsewhere. Reload the calendar and retry.',
                            )
                          : t(
                              'calendarEvents.details.occurrenceError',
                              'The occurrence could not be updated.',
                            )}
                      </Alert>
                    )}
                  </Stack>
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

                {visibleExternalLinks.length > 0 && (
                  <Stack spacing={0.5}>
                    <Typography>
                      {t('calendarEvents.details.links', 'Links')}
                    </Typography>
                    {visibleExternalLinks.map((link, index) => (
                      <Link
                        href={link.href}
                        key={`${link.kind}:${link.href}:${index}`}
                        rel="noopener noreferrer"
                        target="_blank"
                        underline="hover"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </Stack>
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
          event={currentSourceEvent}
          occurrence={
            currentRecurrenceId && currentEvent
              ? { recurrenceId: currentRecurrenceId, event: currentEvent }
              : undefined
          }
          onClose={() => setEditing(false)}
          onSaved={(savedEvent, occurrenceEvent) => {
            setCurrentSourceEvent(savedEvent);
            setCurrentEvent(occurrenceEvent ?? savedEvent);
            onSourceEventChange?.(savedEvent);
          }}
          open={editing}
        />
      )}

      {currentEvent && (
        <ConfirmDeleteDialog
          confirmTitle={t('calendarEvents.delete.confirm', 'Delete')}
          description={
            deletesRecurringSeries
              ? t(
                  'calendarEvents.delete.recurringDescription',
                  'Delete “{{title}}”? This removes the entire recurring series, including every occurrence. This cannot be undone.',
                  { title: currentEvent.title },
                )
              : t(
                  'calendarEvents.delete.description',
                  'Delete “{{title}}”? This cannot be undone.',
                  { title: currentEvent.title },
                )
          }
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

type VisibleCalendarEventExternalLink = {
  kind: CalendarEventExternalLink['kind'];
  href: string;
  label: string;
};

function getVisibleCalendarExternalLinks(
  event: CalendarEvent,
  t: (key: string, defaultValue: string) => string,
): VisibleCalendarEventExternalLink[] {
  if (!Array.isArray(event.externalLinks)) {
    return [];
  }

  return event.externalLinks
    .slice(0, MAX_CALENDAR_EVENT_EXTERNAL_LINKS)
    .flatMap((candidate) => {
      try {
        if (!candidate || typeof candidate !== 'object') {
          return [];
        }

        const href = canonicalizeCalendarExternalUrl(candidate.href);
        if (!href) {
          return [];
        }

        let label: string;
        switch (candidate.kind) {
          case 'event':
            label = t('calendarEvents.details.eventWebsite', 'Event website');
            break;
          case 'attachment':
            label = t('calendarEvents.details.attachment', 'Attachment');
            break;
          case 'conference':
            label =
              boundCalendarEventExternalLinkLabel(candidate.label) ??
              t('calendarEvents.details.conference', 'Conference');
            break;
          default:
            return [];
        }

        return [{ kind: candidate.kind, href, label }];
      } catch {
        // An in-memory producer may supply malformed link objects.
        return [];
      }
    });
}

function uniqueRecurrenceIds(
  recurrenceIds: CalendarEventDateTime[],
): CalendarEventDateTime[] {
  const seen = new Set<string>();
  return recurrenceIds.filter((recurrenceId) => {
    const identity = calendarEventRecurrenceIdentity(recurrenceId);
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}

function formatRecurrenceIdentity(
  recurrenceId: CalendarEventDateTime,
  locale: string,
  viewerTimezone = DateTime.local().zoneName ?? 'UTC',
): string {
  if (recurrenceId.type === 'date') {
    return DateTime.fromISO(recurrenceId.value, { zone: 'UTC' })
      .setLocale(locale)
      .toLocaleString(DateTime.DATE_MED);
  }

  const sourceTimezone =
    recurrenceId.type === 'floating-date-time'
      ? viewerTimezone
      : recurrenceId.value.timezone;
  const local =
    recurrenceId.type === 'floating-date-time'
      ? recurrenceId.value
      : recurrenceId.value.local;
  return DateTime.fromISO(local, { zone: sourceTimezone })
    .setZone(viewerTimezone)
    .setLocale(locale)
    .toLocaleString(DateTime.DATETIME_MED);
}

export function formatCalendarEventTime(
  event: CalendarEvent,
  locale: string,
  allDayLabel: string,
  viewerTimezone = DateTime.local().zoneName ?? 'UTC',
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

  const start = calendarEventTimedDateTimeToDateTime(
    event.timing.start,
    viewerTimezone,
  ).setLocale(locale);
  const end = calendarEventTimedDateTimeToDateTime(
    event.timing.end,
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
