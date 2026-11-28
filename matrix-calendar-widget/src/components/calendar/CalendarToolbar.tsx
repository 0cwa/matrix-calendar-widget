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
import {
  Alert,
  Box,
  Button,
  Snackbar,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { Ref, useCallback, useState } from 'react';
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
import { useIsWideCalendar } from './CalendarNavigation/viewAvailability';
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
  createButtonRef?: Ref<HTMLButtonElement>;
  searchInputRef?: Ref<HTMLInputElement>;
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
  createButtonRef,
  searchInputRef,
}: CalendarToolbarProps) {
  const { t } = useTranslation();
  const compactActions = useMediaQuery('(max-width:479.95px)');
  const wide = useIsWideCalendar();
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
  const showCreate = calendars.loading || writableCalendars.length > 0;
  const showReadOnly = !showCreate && calendars.data.length > 0;

  return (
    <>
      <Stack
        alignItems="center"
        direction="row"
        flexWrap={wide ? 'nowrap' : 'wrap'}
        gap={0.75}
      >
        <Box
          aria-label={t('meetingsToolbar.dateNavigation', 'Date navigation')}
          display="flex"
          alignItems="center"
          flexWrap="nowrap"
          role="group"
          sx={{ flex: wide ? '0 1 auto' : '1 1 100%', minWidth: 0 }}
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
              flex: wide ? '0 1 auto' : '1 1 auto',
              justifyContent: 'flex-start',
              minHeight: 40,
              minWidth: 0,
            }}
            view={view}
          />
        </Box>

        <CalendarNavigation onViewChange={onViewChange} view={view} />

        <Box flex="1 1 7.5rem" minWidth={wide ? '7.5rem' : 0}>
          <CalendarToolbarSearch
            inputRef={searchInputRef}
            onSearchChange={onSearchChange}
            search={filters.filterText ?? ''}
          />
        </Box>

        <Box
          display="flex"
          flexWrap="nowrap"
          gap={0.75}
          alignItems="center"
          justifyContent={!wide && showReadOnly ? 'space-between' : 'flex-end'}
          ml="auto"
          sx={{ flex: wide ? '0 0 auto' : '1 1 100%' }}
        >
          {showCreate ? (
            <Button
              disabled={calendars.loading}
              onClick={() => setCreateOpen(true)}
              ref={createButtonRef}
              startIcon={<AddIcon />}
              sx={{
                flexGrow: wide ? 0 : 1,
                minHeight: 40,
                whiteSpace: 'nowrap',
              }}
              variant="contained"
            >
              {t('calendarEvents.editor.create', 'Create event')}
            </Button>
          ) : showReadOnly ? (
            <Typography
              component="span"
              variant="caption"
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                color: 'text.secondary',
                fontWeight: 500,
                px: 1,
                py: 0.75,
                whiteSpace: 'nowrap',
              }}
            >
              {t('calendars.readOnlyCue', 'Read-only')}
            </Typography>
          ) : null}

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
                        label: t(
                          'calendarPublicFeed.action',
                          'Public read-only subscription',
                        ),
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
                          'Private calendar app access',
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
            compact={compactActions && showCreate}
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
