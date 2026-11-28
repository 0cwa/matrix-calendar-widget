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
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import { WidgetApiMockProvider } from '@matrix-widget-toolkit/react';
import { MockedWidgetApi, mockWidgetApi } from '@matrix-widget-toolkit/testing';
import { useMediaQuery } from '@mui/material';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import { CalendarRepositoryProvider } from '../../calendar';
import { LocalizationProvider } from '../common/LocalizationProvider';
import { CalendarHome } from './CalendarHome';

vi.mock('@mui/material', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mui/material')>()),
  useMediaQuery: vi.fn(),
}));

const calendar: Calendar = {
  id: 'personal',
  name: 'Personal calendar',
  readOnly: false,
  timezone: 'UTC',
};

let widgetApi: MockedWidgetApi;

function createWrapper(repository: InMemoryCalendarRepository) {
  return function Wrapper({ children }: PropsWithChildren<{}>) {
    return (
      <LocalizationProvider>
        <WidgetApiMockProvider value={widgetApi}>
          <CalendarRepositoryProvider repository={repository}>
            {children}
          </CalendarRepositoryProvider>
        </WidgetApiMockProvider>
      </LocalizationProvider>
    );
  };
}

let isWide: boolean;

beforeEach(() => {
  widgetApi = mockWidgetApi();
  isWide = true;
  vi.mocked(useMediaQuery).mockImplementation((query) =>
    query === '(min-width:800px)' ? isWide : true,
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
  localStorage.clear();
});

afterEach(() => {
  widgetApi.stop();
  vi.useRealTimers();
});

function viewStorageKey() {
  return `meeting_view_${widgetApi.widgetParameters.roomId}_${widgetApi.widgetParameters.userId}`;
}

function renderHome(storedView?: string) {
  if (storedView) {
    localStorage.setItem(viewStorageKey(), storedView);
  }
  const view = render(<CalendarHome />, {
    wrapper: createWrapper(
      new InMemoryCalendarRepository({ calendars: [calendar] }),
    ),
  });

  return {
    resize(wide: boolean) {
      isWide = wide;
      view.rerender(<CalendarHome />);
    },
  };
}

function expectView(name: string) {
  expect(screen.getByRole('combobox', { name: 'View' })).toHaveTextContent(
    name,
  );
}

function expectPeriod(name: string) {
  expect(
    within(screen.getByRole('group', { name: 'Date navigation' })).getByRole(
      'button',
      { name },
    ),
  ).toBeInTheDocument();
}

async function chooseView(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'View' }));
  await userEvent.click(screen.getByRole('option', { name }));
}

const press = (name: string) =>
  userEvent.click(screen.getByRole('button', { name }));

describe('<CalendarHome />', () => {
  it('restores the saved view and saves a changed view', async () => {
    const storageKey = `meeting_view_${widgetApi.widgetParameters.roomId}_${widgetApi.widgetParameters.userId}`;
    localStorage.setItem(storageKey, 'month');

    render(<CalendarHome />, {
      wrapper: createWrapper(
        new InMemoryCalendarRepository({ calendars: [calendar] }),
      ),
    });

    expect(
      await screen.findByRole('button', { name: 'Create event' }),
    ).toBeEnabled();
    const viewSelect = screen.getByRole('combobox', { name: 'View' });
    expect(viewSelect).toHaveTextContent('Month');

    await userEvent.click(viewSelect);
    await userEvent.click(screen.getByRole('option', { name: 'Day' }));

    await waitFor(() => expect(viewSelect).toHaveTextContent('Day'));
    expect(localStorage.getItem(storageKey)).toBe('day');
    expect(
      screen.getByRole('navigation', { name: 'Calendar controls' }),
    ).toBeInTheDocument();
  });

  it.each([
    ['list', 'Previous period', 'Next period'],
    ['day', 'Previous day', 'Next day'],
  ])(
    'offers previous, today and next in a narrow %s view',
    (view, previous, next) => {
      isWide = false;
      renderHome(view);

      const buttons = within(
        screen.getByRole('group', { name: 'Date navigation' }),
      ).getAllByRole('button');
      expect(buttons).toHaveLength(4);
      expect(buttons[0]).toHaveAccessibleName(previous);
      expect(buttons[1]).toHaveAccessibleName('Today');
      expect(buttons[2]).toHaveAccessibleName(next);
      expect(buttons[3]).toHaveAccessibleName(/^Choose date/);
    },
  );

  it('steps the list period and returns to today in a narrow widget', async () => {
    isWide = false;
    renderHome();
    const initial =
      'Choose date range, selected range is October 21 – 27, 2026';
    expectPeriod(initial);

    await press('Next period');
    expectPeriod(
      'Choose date range, selected range is October 28 – November 3, 2026',
    );
    await press('Today');
    expectPeriod(initial);
    await press('Previous period');
    expectPeriod('Choose date range, selected range is October 14 – 20, 2026');
  });

  it('returns to the chosen wide view and dates after a narrow day fallback', async () => {
    const { resize } = renderHome('month');
    await press('Previous month');
    expectPeriod('Choose month, selected month is September 2026');

    resize(false);
    expectView('Day');
    expectPeriod('Choose date, selected date is September 1, 2026');
    expect(localStorage.getItem(viewStorageKey())).toBe('month');

    resize(true);
    expectView('Month');
    expectPeriod('Choose month, selected month is September 2026');
  });

  it('shows the chosen wide view around the day selected while narrow', async () => {
    isWide = false;
    const { resize } = renderHome('week');
    expectView('Day');
    expectPeriod('Choose date, selected date is October 21, 2026');

    for (let day = 0; day < 7; day += 1) {
      await press('Next day');
    }
    expectPeriod('Choose date, selected date is October 28, 2026');

    resize(true);
    expectView('Week');
    expectPeriod('Choose week, selected week is October 25 – 31, 2026');

    resize(false);
    expectPeriod('Choose date, selected date is October 28, 2026');
    await press('Today');
    expectPeriod('Choose date, selected date is October 21, 2026');
    expect(localStorage.getItem(viewStorageKey())).toBe('week');
  });

  it('keeps the date chosen in the day view across a wide view and fallback', async () => {
    const { resize } = renderHome('day');
    await press('Next day');
    await chooseView('Week');

    resize(false);
    expectPeriod('Choose date, selected date is October 22, 2026');
  });

  it('saves a view chosen while a day stands in for a wide view', async () => {
    isWide = false;
    const { resize } = renderHome('month');
    await press('Next day');

    await chooseView('List');
    expect(localStorage.getItem(viewStorageKey())).toBe('list');
    expectPeriod('Choose date range, selected range is October 22, 2026');

    resize(true);
    expectView('List');
  });
});
