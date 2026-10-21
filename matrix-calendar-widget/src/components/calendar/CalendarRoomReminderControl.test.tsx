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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentProps, PropsWithChildren } from 'react';
import { afterEach, vi } from 'vitest';
import {
  CalendarRepositoryProvider,
  type CalendarRoomReminderAlarmOption,
  type CalendarRoomReminderConfiguration,
} from '../../calendar';
import { CalendarRoomReminderControl } from './CalendarRoomReminderControl';

const eventUid = 'event@example.test';
const calendarId = 'room-calendar';
const eventId = 'event-resource';
const members = [
  { userId: '@alice:example.test', displayName: 'Alice' },
  { userId: '@bob:example.test', displayName: 'Bob' },
];

afterEach(() => vi.restoreAllMocks());

async function chooseDestination(
  value: 'room' | 'users' | 'off',
  label: string,
) {
  await userEvent.click(
    screen.getByRole('combobox', { name: 'Matrix destination' }),
  );
  await userEvent.click(await screen.findByRole('option', { name: label }));
  expect(
    screen.getByRole('combobox', { name: 'Matrix destination' }),
  ).toHaveTextContent(value === 'room' ? 'Whole room' : label);
}

const timedOption: CalendarRoomReminderAlarmOption = {
  eventUid,
  recurrenceId: null,
  alarmUid: 'alarm-timed-1',
  timingType: 'timed',
  supported: true,
  requiresAllDaySchedule: false,
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

const allDayOption: CalendarRoomReminderAlarmOption = {
  ...timedOption,
  alarmUid: 'alarm-all-day-1',
  timingType: 'all-day',
  requiresAllDaySchedule: true,
};

const unsupportedOption: CalendarRoomReminderAlarmOption = {
  ...timedOption,
  alarmUid: 'alarm-absolute-1',
  supported: false,
  unavailableReason: 'absolute-trigger',
  relatedTo: undefined,
  trigger: undefined,
};

function createConfiguration(
  option: CalendarRoomReminderAlarmOption,
  overrides: Partial<CalendarRoomReminderConfiguration> = {},
): CalendarRoomReminderConfiguration {
  return {
    eventUid: option.eventUid,
    recurrenceId: option.recurrenceId,
    alarmUid: option.alarmUid,
    target: { kind: 'room' },
    allDaySchedule: option.requiresAllDaySchedule
      ? {
          daysBefore: 0,
          localTime: '09:00',
          timezone: 'Europe/Stockholm',
        }
      : null,
    revision: 1,
    ...overrides,
  };
}

function createRepository(
  options: readonly CalendarRoomReminderAlarmOption[],
  configurations: readonly CalendarRoomReminderConfiguration[] = [],
) {
  const enableRoomReminder = vi.fn(async (...args: unknown[]) => {
    const [, , alarmUid, recurrenceId, target, allDaySchedule] = args;
    const option = options.find((candidate) => candidate.alarmUid === alarmUid);
    if (!option) throw new Error('unknown alarm');
    return createConfiguration(option, {
      recurrenceId: recurrenceId as string | null,
      target: target as CalendarRoomReminderConfiguration['target'],
      allDaySchedule:
        allDaySchedule as CalendarRoomReminderConfiguration['allDaySchedule'],
    });
  });
  const disableRoomReminder = vi.fn().mockResolvedValue(undefined);
  const repository = Object.assign(new InMemoryCalendarRepository(), {
    listRoomReminderAlarmOptions: vi.fn().mockResolvedValue(options),
    listRoomReminderConfigurations: vi.fn().mockResolvedValue(configurations),
    enableRoomReminder,
    disableRoomReminder,
  });
  return { repository, enableRoomReminder, disableRoomReminder };
}

function createWrapper(repository: InMemoryCalendarRepository) {
  return function Wrapper({ children }: PropsWithChildren<{}>) {
    return (
      <CalendarRepositoryProvider repository={repository}>
        {children}
      </CalendarRepositoryProvider>
    );
  };
}

function renderControl(
  repository: InMemoryCalendarRepository,
  overrides: Partial<ComponentProps<typeof CalendarRoomReminderControl>> = {},
) {
  return render(
    <CalendarRoomReminderControl
      calendarId={calendarId}
      eventId={eventId}
      eventUid={eventUid}
      members={members}
      calendarTimezone="Europe/Stockholm"
      eventTiming={{
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-21T10:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-10-21T11:00:00',
          timezone: 'Europe/Stockholm',
        },
      }}
      isRecurringSeries={false}
      refreshToken={0}
      canManageReminders
      onEditCalendarReminder={vi.fn()}
      {...overrides}
    />,
    { wrapper: createWrapper(repository) },
  );
}

describe('<CalendarRoomReminderControl />', () => {
  it('shows both CalDAV alarm timing and Matrix destination controls for timed events', async () => {
    const { repository, enableRoomReminder } = createRepository([
      timedOption,
      unsupportedOption,
    ]);
    const onEditCalendarReminder = vi.fn();
    renderControl(repository, { onEditCalendarReminder });

    await userEvent.click(
      screen.getByRole('button', { name: 'Reminder settings' }),
    );

    expect(
      await screen.findByText('Alarm 1: −15m relative to event start'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/CalDAV keeps the calendar alert/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Matrix destination')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This alarm fires at an exact UTC time, so Matrix cannot follow the event if it moves.',
      ),
    ).toBeInTheDocument();

    await chooseDestination('room', 'Whole room');
    await userEvent.click(
      screen.getByRole('button', { name: 'Save Matrix destination' }),
    );

    await waitFor(() => expect(enableRoomReminder).toHaveBeenCalledTimes(1));
    expect(enableRoomReminder).toHaveBeenCalledWith(
      calendarId,
      eventId,
      timedOption.alarmUid,
      null,
      { kind: 'room' },
      null,
    );
    expect(onEditCalendarReminder).not.toHaveBeenCalled();
  });

  it('saves only current selected people and removes departed recipients', async () => {
    const staleConfig = createConfiguration(timedOption, {
      target: {
        kind: 'users',
        userIds: ['@alice:example.test', '@former:example.test'],
      },
    });
    const { repository, enableRoomReminder } = createRepository(
      [timedOption],
      [staleConfig],
    );
    renderControl(repository);

    await userEvent.click(
      screen.getByRole('button', { name: 'Reminder settings' }),
    );
    expect(
      await screen.findByText(/1 saved recipient\(s\) are no longer joined/),
    ).toBeInTheDocument();

    const autocomplete = screen.getByRole('combobox', {
      name: 'Selected people',
    });
    await userEvent.click(autocomplete);
    await userEvent.type(autocomplete, 'Bob');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await userEvent.click(
      screen.getByRole('button', { name: 'Save Matrix destination' }),
    );

    await waitFor(() => expect(enableRoomReminder).toHaveBeenCalledTimes(1));
    expect(enableRoomReminder).toHaveBeenCalledWith(
      calendarId,
      eventId,
      timedOption.alarmUid,
      null,
      { kind: 'users', userIds: ['@alice:example.test', '@bob:example.test'] },
      null,
    );
    expect(
      screen.queryByRole('option', { name: /former/i }),
    ).not.toBeInTheDocument();
  });

  it('warns about a past 09:00 one-time all-day schedule and allows a future time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-10-21T07:30:00.000Z').getTime(),
    );
    const allDayEventTiming = {
      type: 'all-day' as const,
      startDate: '2026-10-21',
      endDate: '2026-10-22',
    };
    const { repository, enableRoomReminder } = createRepository([allDayOption]);
    renderControl(repository, { eventTiming: allDayEventTiming });

    fireEvent.click(screen.getByRole('button', { name: 'Reminder settings' }));
    await screen.findByText('Alarm 1: −15m relative to event start');
    await chooseDestination('room', 'Whole room');
    expect(
      await screen.findByText(
        /This reminder time has already passed\. Matrix does not send past reminders\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Preview: Matrix will ping/)).toHaveTextContent(
      'on 2026-10-21 at 09:00 (Europe/Stockholm)',
    );

    expect(
      screen.getByRole('button', { name: 'Save Matrix destination' }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Local time'), {
      target: { value: '10:00' },
    });
    expect(
      screen.queryByText(/Choose a future time before saving/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save Matrix destination' }),
    ).toBeEnabled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Save Matrix destination' }),
    );
    await waitFor(() => expect(enableRoomReminder).toHaveBeenCalledTimes(1));
    expect(enableRoomReminder.mock.calls[0][5]).toEqual({
      daysBefore: 0,
      localTime: '10:00',
      timezone: 'Europe/Stockholm',
    });
  });

  it('saves an explicit all-day schedule for selected joined members', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-10-20T05:00:00.000Z').getTime(),
    );
    const { repository, enableRoomReminder } = createRepository([allDayOption]);
    renderControl(repository, {
      eventTiming: {
        type: 'all-day',
        startDate: '2026-10-21',
        endDate: '2026-10-22',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reminder settings' }));
    await screen.findByText('Alarm 1: −15m relative to event start');
    await chooseDestination('users', 'Selected people');
    const autocomplete = screen.getByRole('combobox', {
      name: 'Selected people',
    });
    await userEvent.click(autocomplete);
    await userEvent.type(autocomplete, 'Alice');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    fireEvent.change(screen.getByLabelText('Days before event'), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText('Local time'), {
      target: { value: '08:30' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Save Matrix destination' }),
    );

    await waitFor(() => expect(enableRoomReminder).toHaveBeenCalledTimes(1));
    expect(enableRoomReminder).toHaveBeenCalledWith(
      calendarId,
      eventId,
      allDayOption.alarmUid,
      null,
      { kind: 'users', userIds: ['@alice:example.test'] },
      {
        daysBefore: 1,
        localTime: '08:30',
        timezone: 'Europe/Stockholm',
      },
    );
  });

  it('keeps a past occurrence notice clear while allowing a recurring series schedule', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-10-21T07:30:00.000Z').getTime(),
    );
    const { repository } = createRepository([allDayOption]);
    renderControl(repository, {
      eventTiming: {
        type: 'all-day',
        startDate: '2026-10-21',
        endDate: '2026-10-22',
      },
      isRecurringSeries: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reminder settings' }));
    await screen.findByText('Alarm 1: −15m relative to event start');
    await chooseDestination('room', 'Whole room');
    expect(
      await screen.findByText(
        /This time has passed for the selected occurrence\. Matrix does not send past reminders/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save Matrix destination' }),
    ).toBeEnabled();
  });

  it('keeps unsupported alarms visible and opens CalDAV editing', async () => {
    const { repository } = createRepository([unsupportedOption]);
    const onEditCalendarReminder = vi.fn();
    renderControl(repository, { onEditCalendarReminder });

    await userEvent.click(
      screen.getByRole('button', { name: 'Reminder settings' }),
    );
    expect(
      await screen.findByText(
        'This alarm fires at an exact UTC time, so Matrix cannot follow the event if it moves.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Matrix destination'),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit CalDAV reminder' }),
    );
    expect(onEditCalendarReminder).toHaveBeenCalledTimes(1);
  });

  it('does not query reminder settings when the room capability is absent', async () => {
    const { repository } = createRepository([timedOption]);
    renderControl(repository, { canManageReminders: false });

    expect(repository.listRoomReminderAlarmOptions).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Reminder settings' }),
    ).not.toBeInTheDocument();
  });
});
