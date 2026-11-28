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

import { Button, Dialog, Link, useTheme } from '@mui/material';
import { Theme, decomposeColor, getContrastRatio } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CalendarMuiThemeProvider } from './CalendarMuiThemeProvider';

/** The Element theme reads the host's choice from the widget URL. */
function themeWithActions(hostTheme: 'light' | 'dark') {
  window.history.replaceState(null, '', `/?theme=${hostTheme}`);
  let theme!: Theme;
  function Actions() {
    theme = useTheme();
    return (
      <Dialog open>
        <Button>Text action</Button>
        <Button variant="outlined">Outlined action</Button>
        <Button variant="contained">Filled action</Button>
        <Button color="error">Destructive action</Button>
        <Button color="error" variant="contained">
          Filled destructive action
        </Button>
        <Link href="https://example.test">Link action</Link>
      </Dialog>
    );
  }
  render(
    <CalendarMuiThemeProvider>
      <Actions />
    </CalendarMuiThemeProvider>,
  );
  return theme;
}

const style = (name: string) => window.getComputedStyle(screen.getByText(name));

describe('action contrast in the Element theme', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it.each(['light', 'dark'] as const)(
    'keeps action text readable in the %s theme',
    (hostTheme) => {
      const theme = themeWithActions(hostTheme);

      expect(theme.palette.mode).toBe(hostTheme);
      for (const name of [
        'Text action',
        'Outlined action',
        'Destructive action',
        'Link action',
      ]) {
        for (const surface of [
          theme.palette.background.default,
          theme.palette.background.paper,
        ]) {
          expect(
            getContrastRatio(style(name).color, surface),
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const name of ['Filled action', 'Filled destructive action']) {
        const { color, backgroundColor } = style(name);
        expect(getContrastRatio(color, backgroundColor)).toBeGreaterThanOrEqual(
          4.5,
        );
      }
      expect(theme.typography.button.textTransform).toBe('none');
      expect(theme.typography.overline.textTransform).toBe('none');
    },
  );

  it('leaves readable light theme actions unchanged', () => {
    themeWithActions('light');

    expect(style('Text action').color).toBe('#007a61');
    expect(style('Filled action').backgroundColor).toBe('#007a61');
  });

  it.each(['light', 'dark'] as const)(
    'keeps destructive menu items readable while focused in the %s theme',
    (hostTheme) => {
      const { palette } = themeWithActions(hostTheme);
      const surface = decomposeColor(palette.background.paper).values;
      const tint = decomposeColor(palette.text.primary).values;
      const focused = [0, 1, 2].map((channel) =>
        Math.round(
          tint[channel] * palette.action.focusOpacity +
            surface[channel] * (1 - palette.action.focusOpacity),
        ),
      );

      expect(
        getContrastRatio(palette.error.main, `rgb(${focused.join(', ')})`),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('keeps the primary color of the dark theme for navigation', () => {
    expect(themeWithActions('dark').palette.primary.main).toBe('#129a78');
  });

  it('does not lighten raised dark surfaces below their actions', () => {
    themeWithActions('dark');

    expect(
      window.getComputedStyle(screen.getByRole('dialog')).backgroundImage,
    ).toMatch(/^(none)?$/);
  });
});
