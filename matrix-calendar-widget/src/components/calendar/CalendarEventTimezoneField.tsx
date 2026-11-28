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

import { listCalendarTimezones } from '@matrix-calendar-widget/calendar';
import { Autocomplete, Stack, TextField, Typography } from '@mui/material';
import { DateTime } from 'luxon';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { describeCalendarWallTime } from './calendarEventSchedule';
import type { CalendarEventEditorModel } from './useCalendarEventEditor';

const timezones = listCalendarTimezones();
const listedTimezones = new Set(timezones);

/**
 * A searchable IANA zone picker next to the event times. Free text stays
 * allowed so aliases and zones outside the list keep their saved identifier.
 */
export function CalendarEventTimezoneField({
  model,
}: {
  model: CalendarEventEditorModel;
}) {
  const {
    t,
    values,
    handleTimezoneChange,
    validationErrorCode,
    viewerTimezone,
    editingFollowing,
  } = model;
  const { i18n } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  if (!values) return null;

  const timezone = values.timezone;
  const start = describeCalendarWallTime(values.start, timezone);
  const end = describeCalendarWallTime(values.end, timezone);
  const startOffset = start && 'offset' in start ? start.offset : undefined;
  const endOffset = end && 'offset' in end ? end.offset : undefined;
  const offsetText =
    startOffset && endOffset && startOffset !== endOffset
      ? t(
          'calendarEvents.editor.timezoneOffsets',
          '{{start}} at the start, {{end}} at the end',
          { start: startOffset, end: endOffset },
        )
      : startOffset
        ? t(
            'calendarEvents.editor.timezoneOffset',
            '{{offset}} on the start date',
            { offset: startOffset },
          )
        : undefined;

  const viewerRange =
    start && end
      ? formatViewerRange(
          start.instant,
          end.instant,
          timezone,
          viewerTimezone,
          i18n.language,
        )
      : undefined;
  const clockChange = [start, end].some(
    (wallTime) => wallTime && wallTime.status !== 'unique',
  );
  const notes = [
    // Following edits reject skipped and repeated times alike.
    editingFollowing
      ? clockChange
        ? t(
            'calendarEvents.editor.followingClockChange',
            'A clock change skips or repeats one of these times. This and following edits cannot use it.',
          )
        : undefined
      : start?.status === 'skipped'
        ? t(
            'calendarEvents.editor.startSkipped',
            'The start time is skipped by a clock change in this time zone. Check it before saving.',
          )
        : start?.status === 'repeated'
          ? t(
              'calendarEvents.editor.startRepeated',
              'The start time happens twice in this time zone. The first one is used.',
            )
          : undefined,
    editingFollowing
      ? undefined
      : end?.status === 'skipped'
        ? t(
            'calendarEvents.editor.endSkipped',
            'The end time is skipped by a clock change in this time zone. Check it before saving.',
          )
        : end?.status === 'repeated'
          ? t(
              'calendarEvents.editor.endRepeated',
              'The end time happens twice in this time zone. The first one is used.',
            )
          : undefined,
    viewerRange
      ? t(
          'calendarEvents.editor.viewerTime',
          'Your time ({{timezone}}): {{time}}',
          { timezone: viewerTimezone, time: viewerRange },
        )
      : undefined,
  ].filter((note): note is string => Boolean(note));

  return (
    <Stack spacing={0.5}>
      <Autocomplete
        autoHighlight
        disableClearable
        filterOptions={filterTimezones}
        forcePopupIcon
        freeSolo
        inputValue={timezone}
        onChange={(_, selected) => handleTimezoneChange(selected)}
        onInputChange={(_, input, reason) => {
          if (reason === 'input') handleTimezoneChange(input);
        }}
        options={timezones}
        ref={rootRef}
        // Keep the list inside the dialog's modal root, where it stays
        // reachable for assistive technology.
        slotProps={{
          popper: {
            container: () =>
              rootRef.current?.closest('.MuiDialog-root') ?? document.body,
          },
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            error={validationErrorCode === 'invalid-timezone'}
            helperText={offsetText}
            label={t('calendarEvents.editor.timezone', 'Time zone')}
            required
          />
        )}
        // MUI shows the unfiltered list while the input equals the selection,
        // including right after a paste opens it. Only a listed identifier
        // counts as selected, so partial searches always filter.
        value={listedTimezones.has(timezone) ? timezone : ''}
      />
      {notes.map((note) => (
        <Typography color="text.secondary" key={note} variant="body2">
          {note}
        </Typography>
      ))}
    </Stack>
  );
}

/** Match every typed word, so "new york" finds America/New_York. */
export function filterTimezones(
  options: string[],
  { inputValue }: { inputValue: string },
): string[] {
  const query = searchableTimezone(inputValue);
  if (!query) {
    return options;
  }

  const words = query.split(' ');
  const matches = options.filter((option) => {
    const candidate = searchableTimezone(option);
    return words.every((word) => candidate.includes(word));
  });
  // An exact identifier leads, so Enter never swaps it for a longer alias.
  return matches.sort(
    (left, right) =>
      Number(searchableTimezone(right) === query) -
      Number(searchableTimezone(left) === query),
  );
}

function searchableTimezone(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/\s]+/g, ' ')
    .trim();
}

/** The viewer's clock reading, only when it differs from the event's. */
function formatViewerRange(
  startMillis: number,
  endMillis: number,
  timezone: string,
  viewerTimezone: string,
  locale: string,
): string | undefined {
  const viewer = [startMillis, endMillis].map((millis) =>
    DateTime.fromMillis(millis, { zone: viewerTimezone }),
  );
  if (
    viewer.some((time) => !time.isValid) ||
    viewer.every((time) => time.setZone(timezone).offset === time.offset)
  ) {
    return undefined;
  }

  const [from, to] = viewer.map((time) => time.setLocale(locale));
  return `${from.toLocaleString(DateTime.DATETIME_MED)} – ${to.toLocaleString(
    from.hasSame(to, 'day') ? DateTime.TIME_SIMPLE : DateTime.DATETIME_MED,
  )}`;
}
