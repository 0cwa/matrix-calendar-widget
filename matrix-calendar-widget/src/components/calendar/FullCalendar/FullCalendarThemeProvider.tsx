/*
 * Copyright 2022 Nordeck IT + Consulting GmbH
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

import { darken, getContrastRatio, styled, Theme } from '@mui/material';

/**
 * The primary color, darkened if the small event text wouldn't be readable on
 * it, as in Element's dark theme.
 */
function eventBackgroundColor({ palette }: Theme): string {
  const { contrastText, main } = palette.primary;
  return getContrastRatio(contrastText, main) >= 4.5 ? main : darken(main, 0.2);
}

export const FullCalendarThemeProvider = styled('div')(({ theme }) => ({
  // fill the outer container
  height: '100%',

  marginLeft: theme.spacing(1),
  marginRight: theme.spacing(1),

  // Adjust theming of full calendar
  '--fc-page-bg-color': theme.palette.background.default,
  '--fc-border-color': theme.palette.divider,
  '--fc-small-font-size': theme.typography.body2.fontSize,
  '--fc-event-bg-color': eventBackgroundColor(theme),
  '--fc-event-border-color': theme.palette.primary.dark,
  '--fc-event-text-color': theme.palette.primary.contrastText,
  '--fc-event-selected-overlay-color': theme.palette.action.hover,

  // Color for dates of the previous month has not the right contrast
  '& .fc .fc-day-other .fc-daygrid-day-top': {
    opacity: 1,
    '& .fc-daygrid-day-number': {
      color: theme.palette.text.secondary,
    },
  },

  // Make events visually clickable
  '& .fc a.fc-event': {
    cursor: 'pointer',
  },

  // Keep keyboard focus visible on events
  '& .fc a.fc-event:focus-visible': {
    outline: `2px solid ${theme.palette.text.primary}`,
    outlineOffset: 1,
  },

  // Mark today's date with a filled shape in addition to the pale background
  '& .fc .fc-dayGridMonth-view .fc-day-today .fc-daygrid-day-number': {
    backgroundColor: theme.palette.text.primary,
    color: theme.palette.background.default,
    borderRadius: '1em',
    fontWeight: theme.typography.fontWeightBold,
    lineHeight: 1.5,
    // The vertical margin replaces the padding of other day numbers, so that
    // events stay aligned across the week
    margin: '4px 2px',
    minWidth: '1.75em',
    padding: '0 0.4em',
    textAlign: 'center',
    // Forced colors drop the fill but draw this outline
    outline: '2px solid transparent',
  },

  // A table cell's height is a floor. FullCalendar expands the rows when space allows.
  '& .fc .fc-dayGridMonth-view td.fc-day': {
    height: 84,
  },

  '& .fc .fc-dayGridMonth-view .fc-daygrid-event-harness': {
    margin: '1px 2px',
  },
  '& .fc .fc-dayGridMonth-view a.fc-event.mcw-month-timed': {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    '--fc-event-text-color': theme.palette.text.primary,
    '&:hover': { backgroundColor: theme.palette.action.hover },
  },

  '& .fc .fc-timegrid-event .fc-event-main': {
    padding: '0px',

    '& > div': {
      padding: '1px 1px 0',
    },
  },
}));
