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
import { render, screen, waitFor } from '@testing-library/react';
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

beforeEach(() => {
  widgetApi = mockWidgetApi();
  vi.mocked(useMediaQuery).mockReturnValue(true);
  localStorage.clear();
});

afterEach(() => {
  widgetApi.stop();
});

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
});
