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

import { useWidgetApi } from '@matrix-widget-toolkit/react';
import { Box, Stack, Typography } from '@mui/material';
import { unstable_useId as useId, visuallyHidden } from '@mui/utils';
import { DateTime } from 'luxon';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarFilters } from '../../calendar';
import { generateFilterRange } from '../../lib/utils';
import { CalendarEventsSurface } from './CalendarEventsSurface';
import type { CalendarSurfaceView } from './CalendarNavigation';
import { CalendarToolbar } from './CalendarToolbar';

const viewTypes: readonly CalendarSurfaceView[] = [
  'list',
  'day',
  'workWeek',
  'week',
  'month',
];

export function CalendarHome() {
  const widgetApi = useWidgetApi();
  const { t } = useTranslation();
  const viewStorageKey = `meeting_view_${widgetApi.widgetParameters.roomId}_${widgetApi.widgetParameters.userId}`;
  const [view, setViewInternal] = useState<CalendarSurfaceView>(
    () => readLastCalendarSurfaceView(viewStorageKey) ?? 'list',
  );
  const [filters, setFilters] = useState<CalendarFilters>({
    startDate: DateTime.now().startOf('day').toISO(),
    endDate: DateTime.now().plus({ days: 6 }).endOf('day').toISO(),
    filterText: '',
  });

  const setView = useCallback(
    (newView: CalendarSurfaceView) => {
      const previousView = view !== 'list' ? view : undefined;
      setViewInternal(newView);
      saveLastCalendarSurfaceView(viewStorageKey, newView);

      if (newView !== 'list') {
        setFilters((oldFilters) => ({
          ...oldFilters,
          ...generateFilterRange(newView, oldFilters.startDate, previousView),
        }));
      }
    },
    [view, viewStorageKey],
  );

  const handleOnRangeChange = useCallback(
    (startDate: string, endDate: string) =>
      setFilters((oldFilters) => ({ ...oldFilters, startDate, endDate })),
    [],
  );

  const handleOnSearchChange = useCallback(
    (filterText: string) =>
      setFilters((oldFilters) => ({ ...oldFilters, filterText })),
    [],
  );

  const handleShowMore = useCallback(
    (date: Date) => {
      setView('day');
      setFilters((oldFilters) => ({
        ...oldFilters,
        ...generateFilterRange('day', date.toISOString()),
      }));
    },
    [setView],
  );

  const filtersId = useId();

  return (
    <Stack height="100%">
      <Box aria-labelledby={filtersId} component="nav" mx={1}>
        <Typography id={filtersId} sx={visuallyHidden} variant="h3">
          {t('calendarHome.filtersTitle', 'Calendar controls')}
        </Typography>
        <Box my={1}>
          <CalendarToolbar
            filters={filters}
            onRangeChange={handleOnRangeChange}
            onSearchChange={handleOnSearchChange}
            onViewChange={setView}
            view={view}
          />
        </Box>
      </Box>

      <Box flexGrow={1} mb={view === 'list' ? 0 : 1} overflow="hidden">
        <CalendarEventsSurface
          filters={filters}
          onShowMore={handleShowMore}
          view={view}
        />
      </Box>
    </Stack>
  );
}

function readLastCalendarSurfaceView(
  storageKey: string,
): CalendarSurfaceView | undefined {
  try {
    const storedView = window.localStorage.getItem(storageKey);
    return storedView && isCalendarSurfaceView(storedView)
      ? storedView
      : undefined;
  } catch {
    return undefined;
  }
}

function saveLastCalendarSurfaceView(
  storageKey: string,
  view: CalendarSurfaceView,
): void {
  try {
    window.localStorage.setItem(storageKey, view);
  } catch {
    // The current view remains usable when browser storage is unavailable.
  }
}

function isCalendarSurfaceView(value: string): value is CalendarSurfaceView {
  return viewTypes.includes(value as CalendarSurfaceView);
}
