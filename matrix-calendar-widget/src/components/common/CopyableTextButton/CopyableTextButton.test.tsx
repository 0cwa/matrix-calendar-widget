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
    await screen.findByTestId('CheckOutlinedIcon');

    await userEvent.tab();
    expect(screen.getByTestId('ContentCopyOutlinedIcon')).toBeInTheDocument();
  });

  it('shows copy success only after the clipboard write resolves', async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockReturnValueOnce(new Promise<void>(() => undefined));
    render(<CopyableTextButton text="Calendar URL" label="Copy URL" />);

    await userEvent.click(screen.getByRole('button', { name: 'Copy URL' }));

    expect(
      screen.getByRole('button', { name: 'Copy URL' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
    writeText.mockRestore();
  });

  it('does not show success when clipboard writing rejects', async () => {
    const onCopyError = vi.fn();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValueOnce(new Error('Clipboard unavailable'));
    render(
      <CopyableTextButton
        label="Copy URL"
        onCopyError={onCopyError}
        text="Calendar URL"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Copy URL' }));

    expect(onCopyError).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Copy URL' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
    writeText.mockRestore();
  });

  it('should have no accessibility violations', async () => {
    const { container } = render(
      <CopyableTextButton text="http://element.local/#/room/!meeting-room-id" />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
