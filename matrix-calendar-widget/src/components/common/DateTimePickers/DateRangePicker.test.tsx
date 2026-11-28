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

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from 'luxon';
import { ComponentType, PropsWithChildren } from 'react';
import { expect, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { LocalizationProvider } from '../LocalizationProvider';
import { DateRangePicker } from './DateRangePicker';

describe('<DateRangePicker>', () => {
  const onRangeChange = vi.fn();
  let Wrapper: ComponentType<PropsWithChildren<{}>>;

  beforeEach(() => {
    Wrapper = ({ children }: PropsWithChildren<{}>) => {
      return <LocalizationProvider>{children}</LocalizationProvider>;
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should render without exploding', () => {
    render(
      <DateRangePicker
        endDate="2022-02-07T23:59:59Z"
        onRangeChange={onRangeChange}
        startDate="2022-02-01T00:00:00Z"
      />,
      { wrapper: Wrapper },
    );

    expect(
      screen.getByRole('button', {
        name: /Choose date range, selected range is February 1 – 7, 2022/i,
      }),
    ).toHaveTextContent('Feb 1 – 7, 2022');
  });

  it('should have no accessibility violations', async () => {
    const { container } = render(
      <DateRangePicker
        endDate="2022-02-07T23:59:59Z"
        onRangeChange={onRangeChange}
        startDate="2022-02-01T00:00:00Z"
      />,
      { wrapper: Wrapper },
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it('should have no accessibility violations, if date picker is open', async () => {
    const { container } = render(
      <DateRangePicker
        endDate="2022-02-07T23:59:59Z"
        onRangeChange={onRangeChange}
        startDate="2022-02-01T00:00:00Z"
      />,
      { wrapper: Wrapper },
    );

    await userEvent.click(
      screen.getByRole('button', {
        name: /Choose date range, selected range is February 1 – 7, 2022/i,
      }),
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it('should react to input changes', () => {
    const { rerender } = render(
      <DateRangePicker
        endDate="2022-02-07T23:59:59Z"
        onRangeChange={onRangeChange}
        startDate="2022-02-01T00:00:00Z"
      />,
      { wrapper: Wrapper },
    );

    expect(
      screen.getByRole('button', {
        name: /Choose date range, selected range is February 1 – 7, 2022/i,
      }),
    ).toHaveTextContent('Feb 1 – 7, 2022');

    rerender(
      <DateRangePicker
        endDate="2022-02-08T23:59:59Z"
        onRangeChange={onRangeChange}
        startDate="2022-02-03T00:00:00Z"
      />,
    );

    expect(
      screen.getByRole('button', {
        name: /Choose date range, selected range is February 3 – 8, 2022/i,
      }),
    ).toHaveTextContent('Feb 3 – 8, 2022');
  });

  it('should select start and end date', async () => {
    render(
      <DateRangePicker
        endDate="2022-02-07T23:59:59Z"
        onRangeChange={onRangeChange}
        startDate="2022-02-01T00:00:00Z"
      />,
      { wrapper: Wrapper },
    );

    await userEvent.click(
      screen.getByRole('button', {
        name: /Choose date range, selected range is February 1 – 7, 2022/i,
      }),
    );
    await userEvent.click(
      screen.getByRole('button', {
        name: 'calendar view is open, switch to year view',
      }),
    );

    await userEvent.click(screen.getByRole('radio', { name: '2022' }));
    await userEvent.click(screen.getByRole('radio', { name: 'January' }));
    await userEvent.click(screen.getByRole('gridcell', { name: '13' }));

    await userEvent.click(screen.getByRole('gridcell', { name: '20' }));

    expect(onRangeChange).toBeCalledTimes(1);
    expect(onRangeChange).toHaveBeenLastCalledWith(
      '2022-01-13T00:00:00.000Z',
      '2022-01-20T23:59:59.999Z',
    );
  }, 10000);

  it('should not change range if user aborts after selecting a start date', async () => {
    render(
      <DateRangePicker
        endDate="2022-02-07T23:59:59Z"
        onRangeChange={onRangeChange}
        startDate="2022-02-01T00:00:00Z"
      />,
      { wrapper: Wrapper },
    );

    await userEvent.click(
      screen.getByRole('button', {
        name: /Choose date range, selected range is February 1 – 7, 2022/i,
      }),
    );
    await userEvent.click(
      screen.getByRole('button', {
        name: 'calendar view is open, switch to year view',
      }),
    );

    await userEvent.click(screen.getByRole('radio', { name: '2022' }));
    await userEvent.click(screen.getByRole('radio', { name: 'January' }));
    await userEvent.click(screen.getByRole('gridcell', { name: '15' }));

    await userEvent.keyboard('{escape}');

    await userEvent.click(
      screen.getByRole('button', {
        name: /Choose date range, selected range is February 1 – 7, 2022/i,
      }),
    );

    expect(
      screen.getByRole('gridcell', { name: '1', selected: true }),
    ).toBeInTheDocument();
    expect(onRangeChange).not.toBeCalled();
  }, 10000);

  it('should set start and end to the same day', async () => {
    render(
      <DateRangePicker
        endDate="2022-02-07T23:59:59Z"
        onRangeChange={onRangeChange}
        startDate="2022-02-01T00:00:00Z"
      />,
      { wrapper: Wrapper },
    );

    await userEvent.click(
      screen.getByRole('button', {
        name: /Choose date range, selected range is February 1 – 7, 2022/i,
      }),
    );
    await userEvent.click(
      screen.getByRole('button', {
        name: 'calendar view is open, switch to year view',
      }),
    );

    await userEvent.click(screen.getByRole('radio', { name: '2022' }));
    await userEvent.click(screen.getByRole('radio', { name: 'January' }));
    await userEvent.click(screen.getByRole('gridcell', { name: '15' }));

    await userEvent.click(screen.getByRole('gridcell', { name: '15' }));

    expect(onRangeChange).toBeCalledTimes(1);
    expect(onRangeChange).toHaveBeenLastCalledWith(
      '2022-01-15T00:00:00.000Z',
      '2022-01-15T23:59:59.999Z',
    );
  }, 10000);

  it('should not select end before start date', async () => {
    render(
      <DateRangePicker
        endDate="2022-02-07T23:59:59Z"
        onRangeChange={onRangeChange}
        startDate="2022-02-01T00:00:00Z"
      />,
      { wrapper: Wrapper },
    );

    await userEvent.click(
      screen.getByRole('button', {
        name: /Choose date range, selected range is February 1 – 7, 2022/i,
      }),
    );
    await userEvent.click(
      screen.getByRole('button', {
        name: 'calendar view is open, switch to year view',
      }),
    );

    await userEvent.click(screen.getByRole('radio', { name: '2022' }));
    await userEvent.click(screen.getByRole('radio', { name: 'January' }));
    await userEvent.click(screen.getByRole('gridcell', { name: '15' }));

    expect(screen.getByRole('gridcell', { name: '14' })).toBeDisabled();
  }, 10000);

  it('can change the start to an earlier date and complete the range', async () => {
    render(
      <DateRangePicker
        endDate="2022-02-07T23:59:59Z"
        onRangeChange={onRangeChange}
        startDate="2022-02-01T00:00:00Z"
      />,
      { wrapper: Wrapper },
    );
    const trigger = screen.getByRole('button', { name: /Choose date range/ });
    await userEvent.click(trigger);
    expect(
      screen.queryByRole('button', { name: 'Change start' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', {
        name: 'calendar view is open, switch to year view',
      }),
    );
    await userEvent.click(screen.getByRole('radio', { name: '2022' }));
    await userEvent.click(screen.getByRole('radio', { name: 'January' }));
    await userEvent.click(screen.getByRole('gridcell', { name: '15' }));
    expect(screen.getByRole('gridcell', { name: '14' })).toBeDisabled();

    screen.getByRole('button', { name: 'Change start' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Choose a start date.',
    );
    expect(screen.getByRole('gridcell', { name: '14' })).toBeEnabled();
    await waitFor(() =>
      expect(screen.getByRole('gridcell', { name: '15' })).toHaveFocus(),
    );
    await userEvent.click(screen.getByRole('gridcell', { name: '14' }));
    await userEvent.click(screen.getByRole('gridcell', { name: '16' }));

    expect(onRangeChange).toHaveBeenCalledExactlyOnceWith(
      '2022-01-14T00:00:00.000Z',
      '2022-01-16T23:59:59.999Z',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }, 10000);

  it.each(['Cancel', 'Escape'])(
    'preserves the committed range and restores focus on %s',
    async (dismiss) => {
      render(
        <DateRangePicker
          endDate="2022-02-07T23:59:59Z"
          onRangeChange={onRangeChange}
          startDate="2022-02-01T00:00:00Z"
        />,
        { wrapper: Wrapper },
      );
      const trigger = screen.getByRole('button', { name: /Choose date range/ });
      await userEvent.click(trigger);
      await userEvent.click(screen.getByRole('gridcell', { name: '15' }));
      if (dismiss === 'Cancel') {
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      } else {
        await userEvent.keyboard('{Escape}');
      }
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      expect(onRangeChange).not.toHaveBeenCalled();
      await userEvent.click(trigger);
      expect(screen.getByRole('status')).toHaveTextContent(
        'Choose a start date.',
      );
    },
  );

  it('uses Today for both steps when allowed and hides it before the chosen start', async () => {
    const previousNow = Settings.now;
    Settings.now = () => Date.parse('2022-02-05T12:00:00Z');
    try {
      render(
        <DateRangePicker
          endDate="2022-02-07T23:59:59Z"
          onRangeChange={onRangeChange}
          startDate="2022-02-01T00:00:00Z"
        />,
        { wrapper: Wrapper },
      );
      await userEvent.click(
        screen.getByRole('button', { name: /Choose date range/ }),
      );
      await userEvent.click(screen.getByRole('gridcell', { name: '9' }));
      expect(
        screen.queryByRole('button', { name: 'Today' }),
      ).not.toBeInTheDocument();
      await userEvent.click(
        screen.getByRole('button', { name: 'Change start' }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Today' }));
      expect(screen.getByRole('status')).toHaveTextContent(
        'Start: February 5, 2022. Now choose an end date.',
      );
      expect(onRangeChange).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Today' }));
      expect(onRangeChange).toHaveBeenCalledExactlyOnceWith(
        '2022-02-05T00:00:00.000Z',
        '2022-02-05T23:59:59.999Z',
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      Settings.now = previousNow;
    }
  }, 10000);
});
