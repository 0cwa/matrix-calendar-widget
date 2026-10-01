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
      type: 'zoned',
      local: '2026-09-23T09:00',
      timezone: 'Europe/Stockholm',
    },
    end: {
      type: 'zoned',
      local: '2026-09-23T10:00',
      timezone: 'Europe/Stockholm',
    },
  },
};

const floatingEvent: CalendarEvent = {
  id: 'floating',
  calendarId: 'team',
  uid: 'floating@example.test',
  title: 'Floating planning',
  timing: {
    type: 'timed',
    start: { type: 'floating', local: '2026-09-23T09:00:00' },
    end: { type: 'floating', local: '2026-09-23T10:00:00' },
  },
};

const recurringEvent: CalendarEvent = {
  ...event,
  id: 'series-resource',
  uid: 'series@example.test',
  title: 'Weekly planning',
  recurrence: { rrule: 'FREQ=WEEKLY;INTERVAL=2;COUNT=8' },
};

const complexRecurringEvent: CalendarEvent = {
  ...recurringEvent,
  id: 'complex-series-resource',
  recurrence: {
    rrule: 'FREQ=WEEKLY;COUNT=8',
    exdates: [
      {
        type: 'date-time',
        value: { local: '2026-10-07T09:00:00', timezone: 'Europe/Stockholm' },
      },
    ],
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

  it('creates a supported recurring event through CalendarRepository', async () => {
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
        uidFactory={() => 'created-series@example.test'}
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.type(
      await screen.findByRole('textbox', { name: /Title/i }),
      'Created series',
    );
    await userEvent.click(screen.getByLabelText('Repeats'));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Frequency' }),
      'WEEKLY',
    );
    fireEvent.change(screen.getByLabelText(/^Repeat every/), {
      target: { value: '2' },
    });
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Ends' }),
      'count',
    );
    fireEvent.change(screen.getByLabelText(/^Number of occurrences/), {
      target: { value: '5' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await expect(
      repository.getEvent('team', 'created-series'),
    ).resolves.toMatchObject({
      uid: 'created-series@example.test',
      recurrence: { rrule: 'FREQ=WEEKLY;INTERVAL=2;COUNT=5' },
    });
  });

  it('creates, edits, and reloads a weekly weekday set', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      idFactory: () => 'weekly-days',
    });
    const onClose = vi.fn();
    const props = {
      calendars: [calendar],
      onClose,
      open: true,
      uidFactory: () => 'weekly-days@example.test',
    };
    const view = render(<CalendarEventEditorDialog {...props} />, {
      wrapper: createWrapper(repository),
    });

    await userEvent.type(
      await screen.findByRole('textbox', { name: /Title/i }),
      'Weekly planning',
    );
    fireEvent.change(screen.getByLabelText(/^Start/), {
      target: { value: '2026-10-23T09:00' },
    });
    fireEvent.change(screen.getByLabelText(/^End/), {
      target: { value: '2026-10-23T10:00' },
    });
    await userEvent.click(screen.getByLabelText('Repeats'));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Frequency' }),
      'WEEKLY',
    );
    await userEvent.click(screen.getByLabelText('Choose weekdays'));
    expect(screen.getByRole('checkbox', { name: 'Friday' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Friday' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Monday' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const created = await repository.getEvent('team', 'weekly-days');
    expect(created.recurrence).toEqual({
      rrule: 'FREQ=WEEKLY;BYDAY=MO,FR',
    });

    view.rerender(<CalendarEventEditorDialog {...props} event={created} />);
    expect(
      await screen.findByRole('checkbox', { name: 'Choose weekdays' }),
    ).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Monday' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Friday' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tuesday' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await expect(
      repository.getEvent('team', 'weekly-days'),
    ).resolves.toMatchObject({
      recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,FR' },
    });
    const updated = await repository.getEvent('team', 'weekly-days');
    view.rerender(<CalendarEventEditorDialog {...props} event={updated} />);
    expect(
      await screen.findByRole('checkbox', { name: 'Choose weekdays' }),
    ).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Tuesday' })).toBeChecked();
  });

  it('updates the entire selected source series with its current UID and resource id', async () => {
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

    expect(
      await screen.findByText('Changes apply to the entire series.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Frequency' })).toHaveValue(
      'WEEKLY',
    );
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Frequency' }),
      'MONTHLY',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await expect(
      repository.getEvent('team', 'series-resource'),
    ).resolves.toMatchObject({
      id: 'series-resource',
      uid: 'series@example.test',
      recurrence: { rrule: 'FREQ=MONTHLY;INTERVAL=2;COUNT=8' },
    });
  });

  it('adds one typed RDATE while keeping PERIOD values intact', async () => {
    const rdateEvent: CalendarEvent = {
      ...recurringEvent,
      id: 'rdate-series-resource',
      recurrence: {
        rrule: 'FREQ=WEEKLY;COUNT=8',
        rdates: [
          {
            type: 'date-time',
            value: {
              local: '2026-10-26T14:00:00',
              timezone: 'America/New_York',
            },
          },
          {
            type: 'period',
            timing: {
              type: 'duration',
              start: {
                type: 'date-time',
                value: {
                  local: '2026-10-28T14:00:00',
                  timezone: 'Europe/Stockholm',
                },
              },
              duration: {
                weeks: 0,
                days: 0,
                hours: 1,
                minutes: 0,
                seconds: 0,
                isNegative: false,
              },
            },
          },
        ],
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [rdateEvent],
    });

    const view = render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={rdateEvent}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(
      await screen.findByText('Period-valued dates are kept unchanged.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('rdate-draft'), {
      target: { value: '2026-10-05T09:00' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Add date' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const added = await repository.getEvent('team', 'rdate-series-resource');
    expect(added).toMatchObject({
      recurrence: {
        rrule: 'FREQ=WEEKLY;COUNT=8',
        rdates: [
          {
            type: 'date-time',
            value: {
              local: '2026-10-26T14:00:00',
              timezone: 'America/New_York',
            },
          },
          { type: 'period' },
          {
            type: 'date-time',
            value: {
              local: '2026-10-05T09:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
        ],
      },
    });

    view.rerender(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={added}
        onClose={vi.fn()}
        open
      />,
    );
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Remove additional date: 2026-10-05T09:00:00 Europe/Stockholm',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await expect(
      repository.getEvent('team', 'rdate-series-resource'),
    ).resolves.toMatchObject({
      recurrence: {
        rrule: 'FREQ=WEEKLY;COUNT=8',
        rdates: [
          {
            type: 'date-time',
            value: {
              local: '2026-10-26T14:00:00',
              timezone: 'America/New_York',
            },
          },
          { type: 'period' },
        ],
      },
    });
  });

  it('disables recurrence editing for complex sources and preserves them on other edits', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [complexRecurringEvent],
    });

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={complexRecurringEvent}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(
      await screen.findByText(
        'This event includes additional dates or exceptions. Recurrence editing is disabled, and other changes will preserve them.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Repeats')).toBeDisabled();
    const title = screen.getByRole('textbox', { name: /Title/i });
    await userEvent.clear(title);
    await userEvent.type(title, 'Updated complex series');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await expect(
      repository.getEvent('team', 'complex-series-resource'),
    ).resolves.toMatchObject({
      title: 'Updated complex series',
      recurrence: complexRecurringEvent.recurrence,
    });
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

  it('preserves floating timing on a title-only save', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [floatingEvent],
    });
    const onClose = vi.fn();
    const onSaved = vi.fn();

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={floatingEvent}
        onClose={onClose}
        onSaved={onSaved}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(
      await screen.findByText('Floating time (shown in your local time zone)'),
    ).toBeInTheDocument();
    const title = screen.getByRole('textbox', { name: /Title/i });
    await userEvent.clear(title);
    await userEvent.type(title, 'Floating planning renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    await expect(
      repository.getEvent('team', 'floating'),
    ).resolves.toMatchObject({
      title: 'Floating planning renamed',
      timing: floatingEvent.timing,
    });
  });

  it('saves floating timing edits without adding a zone', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [floatingEvent],
    });
    const onSaved = vi.fn();

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={floatingEvent}
        onClose={vi.fn()}
        onSaved={onSaved}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    const start = await screen.findByLabelText(/^Start/);
    const end = await screen.findByLabelText(/^End/);
    fireEvent.change(start, { target: { value: '2026-09-23T11:30' } });
    fireEvent.change(end, { target: { value: '2026-09-23T12:15' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => {
      expect(onSaved).toHaveBeenCalled();
      await expect(
        repository.getEvent('team', 'floating'),
      ).resolves.toMatchObject({
        timing: {
          type: 'timed',
          start: { type: 'floating', local: '2026-09-23T11:30' },
          end: { type: 'floating', local: '2026-09-23T12:15' },
        },
      });
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

  it('creates, edits, reloads, and removes one CalDAV DISPLAY alarm', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      idFactory: () => 'alarm-event',
    });
    const props = {
      calendars: [calendar],
      onClose: vi.fn(),
      open: true,
      uidFactory: () => 'alarm-event@example.test',
    };
    const view = render(<CalendarEventEditorDialog {...props} />, {
      wrapper: createWrapper(repository),
    });

    await userEvent.type(
      await screen.findByRole('textbox', { name: /Title/i }),
      'Alarm event',
    );
    await userEvent.click(screen.getByLabelText('CalDAV reminder'));
    fireEvent.change(screen.getByLabelText('Minutes before'), {
      target: { value: '25' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));

    const created = await repository.getEvent('team', 'alarm-event');
    expect(created.alarm).toEqual({
      action: 'display',
      trigger: { weeks: 0, days: 0, hours: 0, minutes: 25, seconds: 0 },
    });

    view.rerender(<CalendarEventEditorDialog {...props} event={created} />);
    expect(await screen.findByLabelText('CalDAV reminder')).toBeChecked();
    expect(screen.getByLabelText('Minutes before')).toHaveValue(25);
    fireEvent.change(screen.getByLabelText('Minutes before'), {
      target: { value: '40' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const updated = await repository.getEvent('team', 'alarm-event');
    expect(updated.alarm?.trigger.minutes).toBe(40);

    view.rerender(<CalendarEventEditorDialog {...props} event={updated} />);
    await userEvent.click(await screen.findByLabelText('CalDAV reminder'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await expect(
      repository.getEvent('team', 'alarm-event'),
    ).resolves.toMatchObject({ alarm: undefined });
  });

  it('leaves opaque alarms disabled while ordinary event fields remain editable', async () => {
    const opaqueAlarmEvent: CalendarEvent = {
      ...event,
      id: 'opaque-alarm',
      unsupportedAlarm: true,
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [opaqueAlarmEvent],
    });

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={opaqueAlarmEvent}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(
      await screen.findByText(
        'This event contains alarm data this editor cannot safely change. Other event edits will preserve it.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('CalDAV reminder')).toBeDisabled();
    const title = screen.getByRole('textbox', { name: /Title/i });
    expect(title).toBeEnabled();
    await userEvent.clear(title);
    await userEvent.type(title, 'Renamed opaque alarm event');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await expect(
      repository.getEvent('team', 'opaque-alarm'),
    ).resolves.toMatchObject({
      title: 'Renamed opaque alarm event',
      unsupportedAlarm: true,
    });
  });
});
