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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { CopyableTextButton } from './CopyableTextButton';

describe('<CopyableTextButton/>', () => {
  it('should render without exploding', () => {
    render(<CopyableTextButton text="Hallo world" />);

    expect(
      screen.getByRole('button', { name: /copy to clipboard/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    expect(screen.getByTestId('ContentCopyOutlinedIcon')).toBeInTheDocument();
  });

  it('should copy text to clipboard', async () => {
    render(<CopyableTextButton text="Hallo world" />);

    const copyButton = screen.getByRole('button', {
      name: /copy to clipboard/i,
    });
    expect(screen.getByTestId('ContentCopyOutlinedIcon')).toBeInTheDocument();

    await userEvent.click(copyButton);

    expect(navigator.clipboard.writeText).toBeCalledWith('Hallo world');
    expect(screen.getByTestId('CheckOutlinedIcon')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Copied to clipboard');

    await userEvent.tab();
    expect(screen.getByTestId('ContentCopyOutlinedIcon')).toBeInTheDocument();
  });

  it('reports clipboard rejection instead of showing a copied state', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error('clipboard denied'),
    );
    render(<CopyableTextButton text="Hallo world" />);

    await userEvent.click(
      screen.getByRole('button', { name: /copy to clipboard/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not copy to clipboard',
    );
    expect(screen.getByTestId('ErrorOutlineIcon')).toBeInTheDocument();
    expect(screen.queryByTestId('CheckOutlinedIcon')).not.toBeInTheDocument();
  });

  it('includes the item name in the copy action for assistive technology', () => {
    render(
      <CopyableTextButton
        itemLabel="Team calendar URL"
        text="https://example.test/team/"
      />,
    );

    expect(
      screen.getByRole('button', {
        name: /copy team calendar url to clipboard/i,
      }),
    ).toBeInTheDocument();
  });

  it('should have no accessibility violations', async () => {
    const { container } = render(
      <CopyableTextButton text="http://element.local/#/room/!meeting-room-id" />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
