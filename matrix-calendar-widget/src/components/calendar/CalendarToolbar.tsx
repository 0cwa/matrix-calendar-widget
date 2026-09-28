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

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { Box, Button, Stack, useMediaQuery, useTheme } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarFilters,
  isCalendarDiagnosticsRepository,
  useCalendarRepository,
  useCalendars,
} from '../../calendar';
import { MeetingsNavigation, ViewType } from '../meetings/MeetingsNavigation';
import { MeetingsToolbarButtons } from '../meetings/MeetingsToolbar/MeetingsToolbarButtons';
import { MeetingsToolbarDatePicker } from '../meetings/MeetingsToolbar/MeetingsToolbarDatePicker';
import { MeetingsToolbarSearch } from '../meetings/MeetingsToolbar/MeetingsToolbarSearch';
import { CalendarColorDialog } from './CalendarColorDialog';
import { CalendarDiagnosticsDialog } from './CalendarDiagnosticsDialog';
import { CalendarCreateDialog } from './CalendarCreateDialog';
import { CalendarDeleteDialog } from './CalendarDeleteDialog';
import { CalendarDescriptionDialog } from './CalendarDescriptionDialog';
import { CalendarEventEditorDialog } from './CalendarEventEditorDialog';
import { CalendarRenameDialog } from './CalendarRenameDialog';

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
  const { t } = useTranslation();
  const theme = useTheme();
  const showToolbarButtons = useMediaQuery(theme.breakpoints.up('md'));
  const calendars = useCalendars();
  const repository = useCalendarRepository();
  const [createCalendarOpen, setCreateCalendarOpen] = useState(false);
  const [deleteCalendarOpen, setDeleteCalendarOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const supportsDiagnostics = isCalendarDiagnosticsRepository(repository);
  const writableCalendars = calendars.data.filter(
    (calendar) => calendar.readOnly === false,
  );

  return (
    <>
      <Stack direction="row" flexWrap="wrap" gap={1}>
        <Button
          onClick={() => setCreateCalendarOpen(true)}
          startIcon={<AddIcon />}
          variant="outlined"
        >
          {t('calendars.create.action', 'Create calendar')}
        </Button>

        <Button
          color="error"
          disabled={calendars.loading || writableCalendars.length === 0}
          onClick={() => setDeleteCalendarOpen(true)}
          startIcon={<DeleteIcon />}
          variant="outlined"
        >
          {t('calendars.delete.action', 'Delete calendar')}
        </Button>

        <Button
          disabled={calendars.loading || writableCalendars.length === 0}
          onClick={() => setCreateOpen(true)}
          startIcon={<AddIcon />}
          variant="contained"
        >
          {t('calendarEvents.editor.create', 'Create event')}
        </Button>

        <Button
          disabled={calendars.loading || writableCalendars.length === 0}
          onClick={() => setRenameOpen(true)}
          startIcon={<EditIcon />}
          variant="outlined"
        >
          {t('calendars.rename.action', 'Rename calendar')}
        </Button>

        <Button
          disabled={calendars.loading || writableCalendars.length === 0}
          onClick={() => setDescriptionOpen(true)}
          variant="outlined"
        >
          {t('calendars.description.action', 'Edit calendar description')}
        </Button>

        <Button
          disabled={calendars.loading || writableCalendars.length === 0}
          onClick={() => setColorOpen(true)}
          variant="outlined"
        >
          {t('calendars.color.action', 'Edit calendar color')}
        </Button>

        {supportsDiagnostics && (
          <Button onClick={() => setDiagnosticsOpen(true)} variant="outlined">
            {t('calendars.diagnostics.action', 'CalDAV collection URLs')}
          </Button>
        )}

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

      <CalendarCreateDialog
        onClose={() => setCreateCalendarOpen(false)}
        open={createCalendarOpen}
      />

      <CalendarRenameDialog
        calendars={calendars.data}
        onClose={() => setRenameOpen(false)}
        open={renameOpen}
      />

      <CalendarDescriptionDialog
        calendars={calendars.data}
        onClose={() => setDescriptionOpen(false)}
        open={descriptionOpen}
      />

      <CalendarColorDialog
        calendars={calendars.data}
        onClose={() => setColorOpen(false)}
        open={colorOpen}
      />

      {supportsDiagnostics && (
        <CalendarDiagnosticsDialog
          onClose={() => setDiagnosticsOpen(false)}
          open={diagnosticsOpen}
        />
      )}

      <CalendarDeleteDialog
        calendars={writableCalendars}
        onClose={() => setDeleteCalendarOpen(false)}
        open={deleteCalendarOpen}
      />

      <CalendarEventEditorDialog
        calendars={calendars.data}
        onClose={() => setCreateOpen(false)}
        onSaved={() => undefined}
        open={createOpen}
      />
    </>
  );
}
