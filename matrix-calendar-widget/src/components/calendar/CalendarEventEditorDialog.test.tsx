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
  CalendarRepositoryError,
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import { CalendarRepositoryProvider } from '../../calendar';
import { LocalizationProvider } from '../common/LocalizationProvider';
import { CalendarEventEditorDialog } from './CalendarEventEditorDialog';

const calendar: Calendar = {
  id: 'team',
  name: 'Team calendar',
  timezone: 'Europe/Stockholm',
};

const event: CalendarEvent = {
  id: 'planning',
  calendarId: 'team',
  uid: 'planning@example.test',
  title: 'Planning',
  description: 'Original description',
  timing: {
    type: 'timed',
    start: {
      local: '2026-09-23T09:00',
      timezone: 'Europe/Stockholm',
    },
    end: {
      local: '2026-09-23T10:00',
      timezone: 'Europe/Stockholm',
    },
  },
};

const eventWithDisplayAlarms: CalendarEvent = {
  ...event,
  displayAlarms: [
    {
      index: 0,
      description: 'First reminder',
      triggerMinutes: -15,
      triggerRelatedTo: 'start',
      triggerEditable: true,
    },
    {
      index: 1,
      description: 'Second reminder',
      triggerMinutes: -60,
      triggerRelatedTo: 'start',
      triggerEditable: true,
    },
  ],
};

function createWrapper(repository: InMemoryCalendarRepository) {
  return function Wrapper({ children }: PropsWithChildren<{}>) {
    return (
      <LocalizationProvider>
        <CalendarRepositoryProvider repository={repository}>
          {children}
        </CalendarRepositoryProvider>
      </LocalizationProvider>
    );
  };
}

describe('<CalendarEventEditorDialog />', () => {
  it('creates an event through CalendarRepository', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      idFactory: () => 'created',
    });
    const onClose = vi.fn();

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        onClose={onClose}
        open
        uidFactory={() => 'created@example.test'}
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.type(
      await screen.findByRole('textbox', { name: /Title/i }),
      'Created event',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    await expect(repository.getEvent('team', 'created')).resolves.toMatchObject(
      {
        uid: 'created@example.test',
        title: 'Created event',
        calendarId: 'team',
      },
    );
  });

  it('creates a supported series with RDATE and EXDATE from form controls', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      idFactory: () => 'created-series',
    });
    const onClose = vi.fn();

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        onClose={onClose}
        open
        uidFactory={() => 'series@example.test'}
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.type(
      await screen.findByRole('textbox', { name: /Title/i }),
      'Daily series',
    );
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Repeat event' }),
    );
    await userEvent.click(await screen.findByRole('option', { name: 'Daily' }));
    expect(screen.getByRole('checkbox', { name: 'All day' })).toBeDisabled();
    expect(
      screen.getByText(/cannot change while recurrence data is present/i),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add date' }));
    fireEvent.change(screen.getByLabelText(/^Additional date 1\s*\*$/), {
      target: { value: '2026-10-03T09:00' },
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'Add excluded date' }),
    );
    fireEvent.change(screen.getByLabelText(/^Excluded date 1\s*\*$/), {
      target: { value: '2026-10-04T09:00' },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    await expect(
      repository.getEvent('team', 'created-series'),
    ).resolves.toMatchObject({
      recurrence: {
        rrule: 'FREQ=DAILY',
        rdates: [
          {
            type: 'date-time',
            value: {
              local: '2026-10-03T09:00:00',
              timezone: 'Europe/Stockholm',
              mode: 'tzid',
            },
          },
        ],
        exdates: [
          {
            type: 'date-time',
            value: {
              local: '2026-10-04T09:00:00',
              timezone: 'Europe/Stockholm',
              mode: 'tzid',
            },
          },
        ],
      },
    });
  });

  it('keeps the date type selector on DATE for all-day events', async () => {
    const allDayEvent: CalendarEvent = {
      ...event,
      timing: {
        type: 'all-day',
        startDate: '2026-09-23',
        endDate: '2026-09-24',
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [allDayEvent],
    });

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={allDayEvent}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add date' }));
    expect(screen.getByLabelText(/^Additional date 1\s*\*$/)).toHaveAttribute(
      'type',
      'date',
    );
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Additional date 1 type' }),
    );
    expect(
      await screen.findByRole('option', { name: 'All-day date' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'UTC time' }),
    ).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
  });

  it('preserves incompatible loaded recurrence dates on ordinary event edits', async () => {
    const incompatibleEvent: CalendarEvent = {
      ...event,
      recurrence: {
        rrule: 'FREQ=DAILY',
        rdates: [{ type: 'date', value: '2026-09-24' }],
        exdates: [{ type: 'date', value: '2026-09-25' }],
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [incompatibleEvent],
    });
    const updateSpy = vi.spyOn(repository, 'updateEvent');

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={incompatibleEvent}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(
      await screen.findAllByText(
        /saved value does not match the event start type/i,
      ),
    ).toHaveLength(2);
    await userEvent.type(
      await screen.findByRole('textbox', { name: /Title/i }),
      ' updated',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    expect(updateSpy.mock.calls[0][2]).not.toHaveProperty('recurrence');
    await expect(
      repository.getEvent('team', 'planning'),
    ).resolves.toMatchObject({ recurrence: incompatibleEvent.recurrence });
  });

  it('blocks recurrence edits while loaded RDATE and EXDATE types mismatch DTSTART', async () => {
    const incompatibleEvent: CalendarEvent = {
      ...event,
      recurrence: {
        rrule: 'FREQ=DAILY',
        rdates: [{ type: 'date', value: '2026-09-24' }],
        exdates: [{ type: 'date', value: '2026-09-25' }],
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [incompatibleEvent],
    });
    const updateSpy = vi.spyOn(repository, 'updateEvent');

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={incompatibleEvent}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(
      await screen.findByRole('combobox', { name: 'Repeat event' }),
    );
    await userEvent.click(
      await screen.findByRole('option', { name: 'Weekly' }),
    );

    expect(
      await screen.findByText(
        /must use the same date or date-time type as the event start/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(updateSpy).not.toHaveBeenCalled();
    await expect(
      repository.getEvent('team', 'planning'),
    ).resolves.toMatchObject({ recurrence: incompatibleEvent.recurrence });
  });

  it('preserves unsupported loaded rules when saving ordinary event fields', async () => {
    const unsupportedEvent: CalendarEvent = {
      ...event,
      recurrence: { rrule: 'FREQ=DAILY;BYHOUR=9,17' },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [unsupportedEvent],
    });
    const updateSpy = vi.spyOn(repository, 'updateEvent');

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={unsupportedEvent}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(
      await screen.findByText(
        /This recurrence has options this form cannot edit/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Repeat event' }),
    ).not.toBeInTheDocument();
    const title = await screen.findByRole('textbox', { name: /Title/i });
    await userEvent.type(title, ' updated');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    expect(updateSpy.mock.calls[0][2]).not.toHaveProperty('recurrence');
    await expect(
      repository.getEvent('team', 'planning'),
    ).resolves.toMatchObject({
      recurrence: { rrule: 'FREQ=DAILY;BYHOUR=9,17' },
    });
  });

  it('prevents changing timing type on an existing recurring event', async () => {
    const recurringEvent: CalendarEvent = {
      ...event,
      recurrence: {
        rrule: 'FREQ=DAILY;UNTIL=20261001T070000Z',
        rdates: [
          {
            type: 'date-time',
            value: {
              local: '2026-10-02T09:00:00',
              timezone: 'Europe/Stockholm',
              mode: 'tzid',
            },
          },
        ],
        exdates: [
          {
            type: 'date-time',
            value: {
              local: '2026-10-03T09:00:00',
              timezone: 'Europe/Stockholm',
              mode: 'tzid',
            },
          },
        ],
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [recurringEvent],
    });

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={recurringEvent}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    const allDaySwitch = await screen.findByRole('checkbox', {
      name: 'All day',
    });
    expect(allDaySwitch).toBeDisabled();
    expect(
      await screen.findByText(
        /cannot change while recurrence data is present/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Start\s*\*$/)).toHaveAttribute(
      'type',
      'datetime-local',
    );
  });

  it('allows timing type changes on an existing nonrecurring event', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={event}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    const allDaySwitch = await screen.findByRole('checkbox', {
      name: 'All day',
    });
    expect(allDaySwitch).toBeEnabled();
    await userEvent.click(allDaySwitch);
    expect(screen.getByLabelText(/^Start\s*\*$/)).toHaveAttribute(
      'type',
      'date',
    );

    await userEvent.click(allDaySwitch);
    expect(screen.getByLabelText(/^Start\s*\*$/)).toHaveAttribute(
      'type',
      'datetime-local',
    );
  });

  it('requires an explicit replacement before editing an unsupported rule', async () => {
    const unsupportedEvent: CalendarEvent = {
      ...event,
      recurrence: { rrule: 'FREQ=DAILY;BYHOUR=9,17' },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [unsupportedEvent],
    });

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={unsupportedEvent}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Replace with a supported rule',
      }),
    );
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Repeat event' }),
    );
    await userEvent.click(
      await screen.findByRole('option', { name: 'Weekly' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () =>
      expect(await repository.getEvent('team', 'planning')).toMatchObject({
        recurrence: { rrule: 'FREQ=WEEKLY' },
      }),
    );
  });

  it('shows an accessible error and blocks saving for an invalid date value', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
    });

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        onClose={vi.fn()}
        open
        uidFactory={() => 'date-test@example.test'}
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.type(
      await screen.findByRole('textbox', { name: /Title/i }),
      'Date test',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add date' }));
    const dateInput = screen.getByLabelText(/^Additional date 1\s*\*$/);
    fireEvent.change(dateInput, { target: { value: '' } });

    expect(
      await screen.findByText('Enter a valid date or date and time.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create event' })).toBeDisabled();
  });

  it('edits an event through CalendarRepository', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });
    const onSaved = vi.fn();

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={event}
        onClose={vi.fn()}
        onSaved={onSaved}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    const title = await screen.findByRole('textbox', { name: /Title/i });
    await userEvent.clear(title);
    await userEvent.type(title, 'Updated planning');
    await userEvent.clear(
      await screen.findByRole('textbox', { name: /Description/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    await expect(
      repository.getEvent('team', 'planning'),
    ).resolves.toMatchObject({
      title: 'Updated planning',
      description: undefined,
    });
  });

  it('edits multiple existing DISPLAY alarms through accessible controls only', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [eventWithDisplayAlarms],
    });
    const updateSpy = vi.spyOn(repository, 'updateEvent');
    const onSaved = vi.fn();

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={eventWithDisplayAlarms}
        onClose={vi.fn()}
        onSaved={onSaved}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    const firstTrigger = await screen.findByRole('spinbutton', {
      name: 'Display alarm 1 trigger offset (minutes)',
    });
    expect(firstTrigger).toHaveValue(-15);
    expect(
      screen.getByRole('spinbutton', {
        name: 'Display alarm 2 trigger offset (minutes)',
      }),
    ).toHaveValue(-60);
    expect(
      screen.getByRole('textbox', { name: 'Display alarm 2 description' }),
    ).toHaveValue('Second reminder');
    expect(screen.queryByRole('textbox', { name: /email|audio/i })).toBeNull();
    expect(
      screen.getByText(
        'Only these existing display alarms can be edited. Other alarm actions stay unchanged and are not run.',
      ),
    ).toBeInTheDocument();

    fireEvent.change(firstTrigger, { target: { value: '-30' } });
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Display alarm 1 description' }),
      { target: { value: 'Updated first reminder' } },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateSpy.mock.calls[0][2]).toMatchObject({
      displayAlarmEdits: [
        {
          index: 0,
          triggerMinutes: -30,
          description: 'Updated first reminder',
        },
      ],
    });
    await expect(
      repository.getEvent('team', 'planning'),
    ).resolves.toMatchObject({
      displayAlarms: [
        {
          index: 0,
          triggerMinutes: -30,
          description: 'Updated first reminder',
        },
        { index: 1, triggerMinutes: -60, description: 'Second reminder' },
      ],
    });
  });

  it('blocks saving an invalid display alarm trigger', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [eventWithDisplayAlarms],
    });
    const updateSpy = vi.spyOn(repository, 'updateEvent');

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={eventWithDisplayAlarms}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    const trigger = await screen.findByRole('spinbutton', {
      name: 'Display alarm 1 trigger offset (minutes)',
    });
    fireEvent.change(trigger, { target: { value: '' } });

    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(
      await screen.findByText(
        'Enter a whole number of minutes for each editable display alarm.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('keeps an unsupported DISPLAY trigger disabled and preserves it on description edit', async () => {
    const eventWithUnsupportedTrigger: CalendarEvent = {
      ...event,
      displayAlarms: [
        {
          index: 0,
          description: 'Absolute reminder',
          triggerEditable: false,
        },
      ],
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [eventWithUnsupportedTrigger],
    });
    const updateSpy = vi.spyOn(repository, 'updateEvent');

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={eventWithUnsupportedTrigger}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(
      await screen.findByRole('spinbutton', {
        name: 'Display alarm 1 trigger offset (minutes)',
      }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        'This trigger format is preserved and cannot be edited here.',
      ),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Display alarm 1 description' }),
      { target: { value: 'Updated description' } },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledOnce());
    expect(updateSpy.mock.calls[0][2].displayAlarmEdits).toEqual([
      { index: 0, description: 'Updated description' },
    ]);
  });

  it('omits unchanged alarms from an unrelated event patch', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [eventWithDisplayAlarms],
    });
    const updateSpy = vi.spyOn(repository, 'updateEvent');

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={eventWithDisplayAlarms}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    const title = await screen.findByRole('textbox', { name: /Title/i });
    await userEvent.type(title, ' updated');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledOnce());

    expect(updateSpy.mock.calls[0][2]).not.toHaveProperty('displayAlarmEdits');
    await expect(
      repository.getEvent('team', 'planning'),
    ).resolves.toMatchObject({
      displayAlarms: eventWithDisplayAlarms.displayAlarms,
    });
  });

  it('reloads the latest event after an optimistic concurrency conflict', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });
    const latestEvent: CalendarEvent = {
      ...event,
      title: 'Planning changed elsewhere',
      description: 'Latest server description',
    };
    vi.spyOn(repository, 'updateEvent').mockRejectedValueOnce(
      new CalendarRepositoryError(
        'event-conflict',
        'The event changed on the server',
      ),
    );
    vi.spyOn(repository, 'getEvent').mockResolvedValueOnce(latestEvent);
    const onSaved = vi.fn();

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={event}
        onClose={vi.fn()}
        onSaved={onSaved}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    const title = await screen.findByRole('textbox', { name: /Title/i });
    await userEvent.clear(title);
    await userEvent.type(title, 'My stale change');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        'This event changed elsewhere. Reload the latest version before retrying.',
      ),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Reload latest' }),
    );

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(latestEvent));
    expect(screen.getByRole('textbox', { name: /Title/i })).toHaveValue(
      'Planning changed elsewhere',
    );
    expect(
      screen.queryByText(
        'This event changed elsewhere. Reload the latest version before retrying.',
      ),
    ).not.toBeInTheDocument();
  });

  it('disables saving for a read-only calendar', () => {
    const readOnlyCalendar: Calendar = {
      ...calendar,
      readOnly: true,
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [readOnlyCalendar],
      events: [event],
    });

    render(
      <CalendarEventEditorDialog
        calendars={[readOnlyCalendar]}
        event={event}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(screen.getByText('This calendar is read-only.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows an error when an edited event no longer exists', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
    });

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={event}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('The event could not be saved.'),
    ).toBeInTheDocument();
  });

  it.each([
    [
      'recurrence-exception-orphaned',
      'This series change would detach an existing occurrence override. Keep its original occurrence date in the recurrence before saving.',
    ],
    [
      'recurrence-exception-unverifiable',
      'This series change cannot be checked safely because its recurrence rules or timezone data are unsupported or exceed the validation limit. The current event was not changed.',
    ],
  ] as const)(
    'explains %s and keeps the edited series form open',
    async (code, message) => {
      const recurringEvent: CalendarEvent = {
        ...event,
        recurrence: { rrule: 'FREQ=DAILY' },
      };
      const repository = new InMemoryCalendarRepository({
        calendars: [calendar],
        events: [recurringEvent],
      });
      const updateSpy = vi
        .spyOn(repository, 'updateEvent')
        .mockRejectedValue(new CalendarRepositoryError(code, message));
      const onClose = vi.fn();

      render(
        <CalendarEventEditorDialog
          calendars={[calendar]}
          event={recurringEvent}
          onClose={onClose}
          open
        />,
        { wrapper: createWrapper(repository) },
      );

      await userEvent.type(
        await screen.findByRole('textbox', { name: /Title/i }),
        ' revised',
      );
      await userEvent.click(
        screen.getByRole('combobox', { name: 'Repeat event' }),
      );
      await userEvent.click(
        await screen.findByRole('option', { name: 'Weekly' }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: /Title/i })).toHaveValue(
        'Planning revised',
      );
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy.mock.calls[0][2]).toHaveProperty('recurrence');
      expect(onClose).not.toHaveBeenCalled();
    },
  );
});
