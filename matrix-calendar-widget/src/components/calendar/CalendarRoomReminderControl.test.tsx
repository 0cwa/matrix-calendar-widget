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

import { InMemoryCalendarRepository } from '@matrix-calendar-widget/calendar';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PropsWithChildren } from 'react';
import { CalendarRepositoryProvider } from '../../calendar';
import { CalendarRoomReminderControl } from './CalendarRoomReminderControl';

const currentEventUid = 'event@example.test';
const option = {
  eventUid: currentEventUid,
  recurrenceId: null,
  alarmUid: 'alarm-stable-1',
  relatedTo: 'start' as const,
  trigger: {
    weeks: 0,
    days: 0,
    hours: 0,
    minutes: 15,
    seconds: 0,
    isNegative: true,
  },
};
const secondOption = {
  eventUid: currentEventUid,
  recurrenceId: null,
  alarmUid: 'alarm-stable-2',
  relatedTo: 'end' as const,
  trigger: {
    weeks: 0,
    days: 0,
    hours: 0,
    minutes: 30,
    seconds: 0,
    isNegative: false,
  },
  repeat: {
    count: 2,
    interval: {
      weeks: 0,
      days: 0,
      hours: 1,
      minutes: 0,
      seconds: 0,
      isNegative: false,
    },
  },
};

function createWrapper(repository: InMemoryCalendarRepository) {
  return function Wrapper({ children }: PropsWithChildren<{}>) {
    return (
      <CalendarRepositoryProvider repository={repository}>
        {children}
      </CalendarRepositoryProvider>
    );
  };
}

describe('<CalendarRoomReminderControl />', () => {
  it('requires an explicit opt-in and sends only the alarm identity', async () => {
    const identity = {
      eventUid: currentEventUid,
      recurrenceId: null,
      alarmUid: option.alarmUid,
    };
    const enableRoomReminder = vi.fn().mockResolvedValue(identity);
    const disableRoomReminder = vi.fn().mockResolvedValue(undefined);
    const repository = Object.assign(new InMemoryCalendarRepository(), {
      listRoomReminderAlarmOptions: vi
        .fn()
        .mockResolvedValue([option, secondOption]),
      listRoomReminderConfigurations: vi.fn().mockResolvedValue([]),
      enableRoomReminder,
      disableRoomReminder,
    });

    render(
      <CalendarRoomReminderControl
        calendarId="room-calendar"
        canManageReminders
        eventId="https://caldav.example.test/room/event.ics"
        eventUid={identity.eventUid}
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(repository.listRoomReminderAlarmOptions).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Notify room' }));
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Alarm 1: −15m relative to event start',
    });
    const secondCheckbox = screen.getByRole('checkbox', {
      name: 'Alarm 2: 30m relative to event end; repeats 2 times every 1h',
    });
    expect(checkbox).not.toBeChecked();
    expect(secondCheckbox).not.toBeChecked();
    expect(repository.listRoomReminderAlarmOptions).toHaveBeenCalledWith(
      'room-calendar',
      'https://caldav.example.test/room/event.ics',
    );

    await userEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());
    expect(enableRoomReminder).toHaveBeenCalledWith(
      'room-calendar',
      'https://caldav.example.test/room/event.ics',
      option.alarmUid,
      null,
    );

    await userEvent.click(checkbox);
    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(disableRoomReminder).toHaveBeenCalledWith(identity);
  });

  it('shows only a generic unavailable message for failed room settings', async () => {
    const repository = Object.assign(new InMemoryCalendarRepository(), {
      listRoomReminderAlarmOptions: vi
        .fn()
        .mockRejectedValue(new Error('private DAV URL and token')),
      listRoomReminderConfigurations: vi.fn().mockResolvedValue([]),
      enableRoomReminder: vi.fn(),
      disableRoomReminder: vi.fn(),
    });

    render(
      <CalendarRoomReminderControl
        calendarId="room-calendar"
        canManageReminders
        eventId="https://caldav.example.test/room/event.ics"
        eventUid={currentEventUid}
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Notify room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Room reminder settings are unavailable. Try again later.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      'private DAV URL and token',
    );
  });

  it('fails closed when the options endpoint returns duplicate identities', async () => {
    const repository = Object.assign(new InMemoryCalendarRepository(), {
      listRoomReminderAlarmOptions: vi.fn().mockResolvedValue([option, option]),
      listRoomReminderConfigurations: vi.fn().mockResolvedValue([]),
      enableRoomReminder: vi.fn(),
      disableRoomReminder: vi.fn(),
    });

    render(
      <CalendarRoomReminderControl
        calendarId="room-calendar"
        canManageReminders
        eventId="https://caldav.example.test/room/event.ics"
        eventUid={currentEventUid}
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Notify room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Room reminder settings are unavailable. Try again later.',
    );
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('filters options and saved settings by the full event alarm identity', async () => {
    const foreignEventUid = 'another-event@example.test';
    const foreignIdentity = {
      eventUid: foreignEventUid,
      recurrenceId: option.recurrenceId,
      alarmUid: option.alarmUid,
    };
    const identity = {
      eventUid: currentEventUid,
      recurrenceId: option.recurrenceId,
      alarmUid: option.alarmUid,
    };
    const repository = Object.assign(new InMemoryCalendarRepository(), {
      listRoomReminderAlarmOptions: vi
        .fn()
        .mockResolvedValue([{ ...option, eventUid: foreignEventUid }, option]),
      listRoomReminderConfigurations: vi
        .fn()
        .mockResolvedValue([foreignIdentity, identity]),
      enableRoomReminder: vi.fn(),
      disableRoomReminder: vi.fn(),
    });

    render(
      <CalendarRoomReminderControl
        calendarId="room-calendar"
        canManageReminders
        eventId="https://caldav.example.test/room/event.ics"
        eventUid={currentEventUid}
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Notify room' }));
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Alarm 1: −15m relative to event start',
    });
    expect(checkbox).toBeChecked();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
