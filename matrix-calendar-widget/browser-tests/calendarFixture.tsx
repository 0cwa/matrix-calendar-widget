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
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import {
  Box,
  Button,
  CssBaseline,
  Stack,
  ThemeProvider,
  createTheme,
} from '@mui/material';
import i18next from 'i18next';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '../public/locales/en/translation.json';
import { CalendarRepositoryProvider } from '../src/calendar/CalendarRepositoryProvider';
import { CalendarEventDetailsDialog } from '../src/components/calendar/CalendarEventDetailsDialog';
import { CalendarEventsCalendar } from '../src/components/calendar/CalendarEventsCalendar';
import { CalendarEventsList } from '../src/components/calendar/CalendarEventsList';
import { LocalizationProvider } from '../src/components/common/LocalizationProvider';
import { registerDateRangeFormatter } from '../src/dateRangeFormatter';

// Synthetic data only: this fixture has no Matrix client or gateway connection.
const events: CalendarEvent[] = Array.from({ length: 8 }, (_, index) => ({
  id: 'synthetic-' + index,
  uid: 'synthetic-' + index + '@example.test',
  calendarId: 'synthetic',
  title:
    index === 0
      ? 'Synthetic planning'
      : 'Synthetic long title ' + 'calendar'.repeat(20) + ' ' + index,
  description: 'Synthetic description ' + 'description'.repeat(30),
  location: 'Synthetic location ' + 'location'.repeat(30),
  timing: {
    type: 'timed',
    start: {
      type: 'zoned',
      local: index === 0 ? '2026-10-05T08:00:00' : '2026-10-05T09:00:00',
      timezone: 'Europe/Stockholm',
    },
    end: {
      type: 'zoned',
      local: index === 0 ? '2026-10-05T09:00:00' : '2026-10-05T10:00:00',
      timezone: 'Europe/Stockholm',
    },
  },
}));
const repository = new InMemoryCalendarRepository({
  calendars: [{ id: 'synthetic', name: 'Synthetic calendar' }],
  events,
});
const theme = createTheme();

function CalendarFixture() {
  const [view, setView] = useState<'list' | 'month'>('list');
  const [selected, setSelected] = useState<CalendarEvent>();
  return (
    <main>
      <Stack spacing={2} sx={{ p: 2 }}>
        <h1>Calendar component validation</h1>
        <Stack direction="row" spacing={1}>
          <Button onClick={() => setView('list')}>List</Button>
          <Button onClick={() => setView('month')}>Month</Button>
        </Stack>
        <Box data-testid="calendar-surface">
          {view === 'list' ? (
            <CalendarEventsList events={events} onSelectEvent={setSelected} />
          ) : (
            <Box sx={{ height: 600 }}>
              <CalendarEventsCalendar
                events={events}
                filters={{
                  startDate: '2026-10-01T00:00:00+02:00',
                  endDate: '2026-11-01T00:00:00+01:00',
                }}
                onSelectEvent={setSelected}
                onShowMore={() => setView('list')}
                view="month"
              />
            </Box>
          )}
        </Box>
      </Stack>
      <CalendarEventDetailsDialog
        event={selected}
        onClose={() => setSelected(undefined)}
      />
    </main>
  );
}

async function start() {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: { en: { translation: en } },
  });
  registerDateRangeFormatter(i18next);
  createRoot(document.getElementById('root')!).render(
    <I18nextProvider i18n={i18next}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LocalizationProvider>
          <CalendarRepositoryProvider repository={repository}>
            <CalendarFixture />
          </CalendarRepositoryProvider>
        </LocalizationProvider>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

void start();
