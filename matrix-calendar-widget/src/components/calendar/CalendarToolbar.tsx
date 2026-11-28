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
import NotesIcon from '@mui/icons-material/Notes';
import PaletteIcon from '@mui/icons-material/Palette';
import PhonelinkLockIcon from '@mui/icons-material/PhonelinkLock';
import RssFeedIcon from '@mui/icons-material/RssFeed';
import { Alert, Box, Button, Snackbar, Stack } from '@mui/material';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarFilters,
  isCalendarPrivateClientRepository,
  isCalendarPublicFeedRepository,
  useCalendarRepository,
  useCalendars,
} from '../../calendar';
import { CalendarColorDialog } from './CalendarColorDialog';
import { CalendarCreateDialog } from './CalendarCreateDialog';
import { CalendarDeleteDialog } from './CalendarDeleteDialog';
import { CalendarDescriptionDialog } from './CalendarDescriptionDialog';
import { CalendarEventEditorDialog } from './CalendarEventEditorDialog';
import { CalendarNavigation, CalendarSurfaceView } from './CalendarNavigation';
import { CalendarPrivateClientDialog } from './CalendarPrivateClientDialog';
import { CalendarPublicFeedDialog } from './CalendarPublicFeedDialog';
import { CalendarRenameDialog } from './CalendarRenameDialog';
import { calendarOptionNotes } from './CalendarToolbar/calendarOptionNotes';
import { CalendarOptionsMenu } from './CalendarToolbar/CalendarOptionsMenu';
import { CalendarToolbarButtons } from './CalendarToolbar/CalendarToolbarButtons';
import { CalendarToolbarDatePicker } from './CalendarToolbar/CalendarToolbarDatePicker';
import { CalendarToolbarSearch } from './CalendarToolbar/CalendarToolbarSearch';

type CalendarToolbarProps = {
  filters: CalendarFilters;
  view: CalendarSurfaceView;
  onRangeChange: (startDate: string, endDate: string) => void;
  onSearchChange: (search: string) => void;
  onViewChange: (view: CalendarSurfaceView) => void;
};

type StalePrivateClientRecovery = {
  calendarName: string;
  createdAt: string;
};

export function CalendarToolbar({
  filters,
  view,
  onRangeChange,
  onSearchChange,
  onViewChange,
}: CalendarToolbarProps) {
  const { t } = useTranslation();
  const calendars = useCalendars();
  const calendarRepository = useCalendarRepository();
  const supportsPublicFeeds =
    isCalendarPublicFeedRepository(calendarRepository);
  const supportsPrivateClients =
    isCalendarPrivateClientRepository(calendarRepository);
  const [createCalendarOpen, setCreateCalendarOpen] = useState(false);
  const [deleteCalendarOpen, setDeleteCalendarOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [publicFeedOpen, setPublicFeedOpen] = useState(false);
  const [privateClientOpen, setPrivateClientOpen] = useState(false);
  const [privateClientRecovery, setPrivateClientRecovery] = useState<
    StalePrivateClientRecovery[]
  >([]);
  const reportPrivateClientRecovery = useCallback(
    (details: StalePrivateClientRecovery) => {
      setPrivateClientRecovery((current) => [...current, details]);
    },
    [],
  );
  const dismissPrivateClientRecovery = () => {
    setPrivateClientRecovery((current) => current.slice(1));
  };
  const writableCalendars = calendars.data.filter(
    (calendar) => calendar.readOnly === false,
  );
  const collectionCalendars = calendars.data.filter(
    (calendar) => calendar.operatorManaged !== true,
  );
  const writableCollectionCalendars = collectionCalendars.filter(
    (calendar) => calendar.readOnly === false,
  );
  // These checks only decide what to offer. The server authorizes each action.
  const canChangeCalendars =
    !calendars.loading && writableCollectionCalendars.length > 0;
  const canShareCalendars = !calendars.loading && calendars.data.length > 0;

  return (
    <>
      <Stack alignItems="center" direction="row" flexWrap="wrap" gap={1}>
        <Box
          aria-label={t('meetingsToolbar.dateNavigation', 'Date navigation')}
          display="flex"
          alignItems="center"
          flexWrap="wrap"
          role="group"
          sx={{ flex: { xs: '1 1 100%', md: '0 0 auto' }, minWidth: 0 }}
        >
          <CalendarToolbarButtons
            endDate={filters.endDate}
            onRangeChange={onRangeChange}
            startDate={filters.startDate}
            view={view}
          />
          <CalendarToolbarDatePicker
            endDate={filters.endDate}
            onRangeChange={onRangeChange}
            startDate={filters.startDate}
            sx={{
              flex: '1 1 8rem',
              justifyContent: 'flex-start',
              minHeight: 40,
              minWidth: 0,
            }}
            view={view}
          />
        </Box>

        <CalendarNavigation onViewChange={onViewChange} view={view} />

        <Box flex="1 1 10rem" minWidth={0}>
          <CalendarToolbarSearch
            onSearchChange={onSearchChange}
            search={filters.filterText ?? ''}
          />
        </Box>

        <Box
          display="flex"
          flexWrap="wrap"
          gap={1}
          justifyContent="flex-end"
          ml="auto"
          sx={{ flex: { xs: '1 1 100%', sm: '0 0 auto' } }}
        >
          <Button
            disabled={calendars.loading || writableCalendars.length === 0}
            onClick={() => setCreateOpen(true)}
            startIcon={<AddIcon />}
            sx={{ flexGrow: 1, minHeight: 40 }}
            variant="contained"
          >
            {t('calendarEvents.editor.create', 'Create event')}
          </Button>

          <CalendarOptionsMenu
            groups={[
              [
                ...(calendars.canManageCalendarCollections
                  ? [
                      {
                        label: t('calendars.create.action', 'Create calendar'),
                        icon: <AddIcon />,
                        onSelect: () => setCreateCalendarOpen(true),
                      },
                    ]
                  : []),
                ...(canChangeCalendars
                  ? [
                      {
                        label: t('calendars.rename.action', 'Rename calendar'),
                        icon: <EditIcon />,
                        onSelect: () => setRenameOpen(true),
                      },
                      {
                        label: t(
                          'calendars.description.action',
                          'Edit calendar description',
                        ),
                        icon: <NotesIcon />,
                        onSelect: () => setDescriptionOpen(true),
                      },
                      {
                        label: t(
                          'calendars.color.action',
                          'Edit calendar color',
                        ),
                        icon: <PaletteIcon />,
                        onSelect: () => setColorOpen(true),
                      },
                    ]
                  : []),
              ],
              [
                ...(canShareCalendars && supportsPublicFeeds
                  ? [
                      {
                        label: t('calendarPublicFeed.action', 'Public feed'),
                        icon: <RssFeedIcon />,
                        onSelect: () => setPublicFeedOpen(true),
                      },
                    ]
                  : []),
                ...(canShareCalendars && supportsPrivateClients
                  ? [
                      {
                        label: t(
                          'calendarPrivateClient.action',
                          'Calendar app access',
                        ),
                        icon: <PhonelinkLockIcon />,
                        onSelect: () => setPrivateClientOpen(true),
                      },
                    ]
                  : []),
              ],
              canChangeCalendars
                ? [
                    {
                      label: t('calendars.delete.action', 'Delete calendar'),
                      icon: <DeleteIcon />,
                      destructive: true,
                      onSelect: () => setDeleteCalendarOpen(true),
                    },
                  ]
                : [],
            ]}
            notes={calendarOptionNotes(calendars, t)}
          />
        </Box>
      </Stack>

      <CalendarCreateDialog
        onClose={() => setCreateCalendarOpen(false)}
        open={createCalendarOpen}
      />

      <CalendarRenameDialog
        calendars={collectionCalendars}
        onClose={() => setRenameOpen(false)}
        open={renameOpen}
      />

      <CalendarDescriptionDialog
        calendars={collectionCalendars}
        onClose={() => setDescriptionOpen(false)}
        open={descriptionOpen}
      />

      <CalendarColorDialog
        calendars={collectionCalendars}
        onClose={() => setColorOpen(false)}
        open={colorOpen}
      />

      <CalendarDeleteDialog
        calendars={writableCollectionCalendars}
        onClose={() => setDeleteCalendarOpen(false)}
        open={deleteCalendarOpen}
      />

      {supportsPublicFeeds && (
        <CalendarPublicFeedDialog
          calendars={calendars.data}
          onClose={() => setPublicFeedOpen(false)}
          open={publicFeedOpen}
        />
      )}

      {supportsPrivateClients && (
        <CalendarPrivateClientDialog
          calendars={calendars.data}
          onClose={() => setPrivateClientOpen(false)}
          onStaleClientCleanupFailed={reportPrivateClientRecovery}
          open={privateClientOpen}
        />
      )}

      <Snackbar
        anchorOrigin={{ horizontal: 'center', vertical: 'bottom' }}
        onClose={(_, reason) => {
          if (reason !== 'clickaway') dismissPrivateClientRecovery();
        }}
        open={privateClientRecovery.length > 0}
      >
        <Alert onClose={dismissPrivateClientRecovery} severity="warning">
          {t('calendarPrivateClient.cleanupFailed', {
            calendar: privateClientRecovery[0]?.calendarName ?? '',
            date: privateClientRecovery[0]?.createdAt ?? '',
            defaultValue:
              'App access created for “{{calendar}}” on {{date}} may still be active. Open that calendar’s app access settings and check for an entry created then; revoke it if present.',
          })}
        </Alert>
      </Snackbar>

      <CalendarEventEditorDialog
        calendars={calendars.data}
        onClose={() => setCreateOpen(false)}
        onSaved={() => undefined}
        open={createOpen}
      />
    </>
  );
}
