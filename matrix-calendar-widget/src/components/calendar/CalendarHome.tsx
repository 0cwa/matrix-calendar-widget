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
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarEventsSurface } from './CalendarEventsSurface';
import { CalendarToolbar } from './CalendarToolbar';
import { useCalendarSurfaceState } from './useCalendarSurfaceState';

export function CalendarHome() {
  const widgetApi = useWidgetApi();
  const { t } = useTranslation();
  const viewStorageKey = `meeting_view_${widgetApi.widgetParameters.roomId}_${widgetApi.widgetParameters.userId}`;
  const { view, filters, setView, setRange, setSearch, showDay } =
    useCalendarSurfaceState(viewStorageKey);

  const filtersId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Stack height="100%">
      <Box aria-labelledby={filtersId} component="nav" mx={1}>
        <Typography id={filtersId} sx={visuallyHidden} variant="h3">
          {t('calendarHome.filtersTitle', 'Calendar controls')}
        </Typography>
        <Box my={0.75}>
          <CalendarToolbar
            createButtonRef={createButtonRef}
            filters={filters}
            onRangeChange={setRange}
            onSearchChange={setSearch}
            onViewChange={setView}
            searchInputRef={searchInputRef}
            view={view}
          />
        </Box>
      </Box>

      <Box flexGrow={1} mb={view === 'list' ? 0 : 1} overflow="hidden">
        <CalendarEventsSurface
          filters={filters}
          onClearSearch={() => {
            setSearch('');
            searchInputRef.current?.focus();
          }}
          // Focus the toolbar button first: it stays after the empty state is
          // gone, so closing the editor returns focus to it.
          onCreateEvent={() => {
            createButtonRef.current?.focus();
            createButtonRef.current?.click();
          }}
          onShowMore={showDay}
          view={view}
        />
      </Box>
    </Stack>
  );
}
