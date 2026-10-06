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
  Calendar,
  CalendarEvent,
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import type {
  CalendarEventListResult,
  CalendarId,
  CalendarTimeRange,
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
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '../public/locales/en/translation.json';
import { CalendarRepositoryProvider } from '../src/calendar';
import type {
  CalendarTargetAvailabilityRepository,
  CalendarRoomCapabilities,
  CalendarRoomReminderRepository,
  CalendarRoomReminderAlarmOption,
  CalendarRoomReminderIdentity,
} from '../src/calendar';
import { CalendarEventDetailsDialog } from '../src/components/calendar/CalendarEventDetailsDialog';
import { CalendarEventsCalendar } from '../src/components/calendar/CalendarEventsCalendar';
import { CalendarEventsList } from '../src/components/calendar/CalendarEventsList';
import { CalendarEventsSurface } from '../src/components/calendar/CalendarEventsSurface';
import { CalendarToolbar } from '../src/components/calendar/CalendarToolbar';
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
const roomCalendar: Calendar = {
  id: 'synthetic-room-calendar',
  name: 'Room calendar',
  timezone: 'Europe/Stockholm',
  operatorManaged: true,
  supportedComponents: ['VEVENT'],
};
const roomEvent: CalendarEvent = {
  id: 'synthetic-room-event',
  uid: 'synthetic-room-event@example.test',
  calendarId: roomCalendar.id,
  title: 'Synthetic room planning',
  description: 'A deterministic room-owned event for browser validation.',
  location: 'Synthetic meeting room',
  timing: {
    type: 'timed',
    start: {
      type: 'zoned',
      local: '2026-10-05T08:00:00',
      timezone: 'Europe/Stockholm',
    },
    end: {
      type: 'zoned',
      local: '2026-10-05T09:00:00',
      timezone: 'Europe/Stockholm',
    },
  },
};
const roomAlarmOption: CalendarRoomReminderAlarmOption = {
  eventUid: roomEvent.uid,
  recurrenceId: null,
  alarmUid: 'synthetic-room-alarm',
  relatedTo: 'start',
  trigger: {
    weeks: 0,
    days: 0,
    hours: 0,
    minutes: 15,
    seconds: 0,
    isNegative: true,
  },
};
const theme = createTheme();

function CalendarFixture() {
  const [view, setView] = useState<'list' | 'month'>('list');
  const [selected, setSelected] = useState<CalendarEvent>();
  const query = new URLSearchParams(window.location.search);
  const roomMode = query.get('mode');
  const roomRepository = useMemo(
    () =>
      roomMode === 'room-read-only' || roomMode === 'room-manager'
        ? new SyntheticRoomCalendarRepository(roomMode === 'room-manager')
        : undefined,
    [roomMode],
  );
  const [filters, setFilters] = useState({
    startDate: '2026-10-01T00:00:00+02:00',
    endDate: '2026-11-01T00:00:00+01:00',
    filterText: '',
  });

  if (roomRepository) {
    return (
      <CalendarRepositoryProvider repository={roomRepository}>
        <main>
          <Stack spacing={2} sx={{ p: 1 }}>
            <h1>Calendar component validation</h1>
            <Stack direction="row" spacing={1}>
              <Button onClick={() => setView('list')}>List</Button>
              <Button onClick={() => setView('month')}>Month</Button>
            </Stack>
            <CalendarToolbar
              filters={filters}
              onRangeChange={(startDate, endDate) =>
                setFilters((current) => ({ ...current, startDate, endDate }))
              }
              onSearchChange={(filterText) =>
                setFilters((current) => ({ ...current, filterText }))
              }
              onViewChange={setView}
              view={view}
            />
            <Box data-testid="calendar-surface" sx={{ minWidth: 0 }}>
              <CalendarEventsSurface
                filters={filters}
                onShowMore={() => setView('list')}
                view={view}
              />
            </Box>
          </Stack>
        </main>
      </CalendarRepositoryProvider>
    );
  }

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

/**
 * Synthetic implementation of the same optional room capabilities the
 * gateway repository exposes. It wraps the real in-memory calendar store and
 * never contacts Matrix, a gateway, CalDAV, or a reminder sender.
 */
class SyntheticRoomCalendarRepository
  extends InMemoryCalendarRepository
  implements
    CalendarTargetAvailabilityRepository,
    CalendarRoomReminderRepository
{
  private readonly capabilities: CalendarRoomCapabilities;
  private readonly reminderConfigurations = new Map<
    string,
    CalendarRoomReminderIdentity
  >();

  constructor(private readonly manager: boolean) {
    super({ calendars: [roomCalendar], events: [roomEvent] });
    this.capabilities = {
      calendarId: roomCalendar.id,
      roomId: '!synthetic-room:example.test',
      canReadEvents: true,
      canWriteEvents: manager,
      canManageReminders: manager,
    };
  }

  async getRoomCalendarCapabilities(): Promise<
    CalendarRoomCapabilities | undefined
  > {
    return this.capabilities;
  }

  async listCalendarsWithAvailability() {
    const calendars = await super.listCalendars();
    return {
      calendars: calendars.map((calendar) => ({
        ...calendar,
        readOnly: !this.capabilities.canWriteEvents,
        operatorManaged: true,
      })),
      partialAvailability: false,
      canManageCalendarCollections: false,
      roomCapabilities: this.capabilities,
    };
  }

  async listEventsWithAvailability(
    calendarIds: CalendarId[],
    range: CalendarTimeRange,
  ): Promise<CalendarEventListResult & { partialAvailability: boolean }> {
    return {
      events: await super.listEvents(calendarIds, range),
      diagnostics: [],
      partialAvailability: false,
    };
  }

  async listRoomReminderAlarmOptions(
    calendarId: CalendarId,
    eventId: string,
  ): Promise<CalendarRoomReminderAlarmOption[]> {
    const event = await super.getEvent(calendarId, eventId);
    return event.uid === roomAlarmOption.eventUid ? [roomAlarmOption] : [];
  }

  async listRoomReminderConfigurations(): Promise<
    CalendarRoomReminderIdentity[]
  > {
    return [...this.reminderConfigurations.values()];
  }

  async enableRoomReminder(
    calendarId: CalendarId,
    eventId: string,
    alarmUid: string,
    recurrenceId: string | null,
  ): Promise<CalendarRoomReminderIdentity> {
    const event = await super.getEvent(calendarId, eventId);
    if (
      !this.manager ||
      alarmUid !== roomAlarmOption.alarmUid ||
      recurrenceId !== roomAlarmOption.recurrenceId
    ) {
      throw new Error('Synthetic room reminder is unavailable');
    }
    const identity = { eventUid: event.uid, alarmUid, recurrenceId };
    this.reminderConfigurations.set(alarmUid, identity);
    return identity;
  }

  async disableRoomReminder(
    identity: CalendarRoomReminderIdentity,
  ): Promise<void> {
    if (!this.manager) {
      throw new Error('Synthetic room reminder is unavailable');
    }
    this.reminderConfigurations.delete(identity.alarmUid);
  }
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
