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

import { Box, Stack, useMediaQuery, useTheme } from '@mui/material';
import { CalendarFilters } from '../../calendar';
import { MeetingsNavigation, ViewType } from '../meetings/MeetingsNavigation';
import { MeetingsToolbarButtons } from '../meetings/MeetingsToolbar/MeetingsToolbarButtons';
import { MeetingsToolbarDatePicker } from '../meetings/MeetingsToolbar/MeetingsToolbarDatePicker';
import { MeetingsToolbarSearch } from '../meetings/MeetingsToolbar/MeetingsToolbarSearch';

type CalendarToolbarProps = {
  filters: CalendarFilters;
  view: ViewType;
  onRangeChange: (startDate: string, endDate: string) => void;
  onSearchChange: (search: string) => void;
  onViewChange: (view: ViewType) => void;
};

export function CalendarToolbar({
  filters,
  view,
  onRangeChange,
  onSearchChange,
  onViewChange,
}: CalendarToolbarProps) {
  const theme = useTheme();
  const showToolbarButtons = useMediaQuery(theme.breakpoints.up('md'));

  return (
    <Stack direction="row" flexWrap="wrap" gap={1}>
      {showToolbarButtons && (
        <Box>
          <MeetingsToolbarButtons
            endDate={filters.endDate}
            onRangeChange={onRangeChange}
            startDate={filters.startDate}
            view={view}
          />
        </Box>
      )}

      <MeetingsToolbarDatePicker
        endDate={filters.endDate}
        onRangeChange={onRangeChange}
        startDate={filters.startDate}
        sx={{ flexGrow: 1 }}
        view={view}
      />

      <Box flex={99999999} textAlign="right">
        <MeetingsToolbarSearch
          onSearchChange={onSearchChange}
          search={filters.filterText ?? ''}
        />
      </Box>

      <MeetingsNavigation
        onViewChange={onViewChange}
        sx={{ flexGrow: 1 }}
        view={view}
      />
    </Stack>
  );
}
