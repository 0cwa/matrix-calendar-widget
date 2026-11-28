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
  Theme,
  ThemeOptions,
  alpha,
  darken,
  decomposeColor,
  getContrastRatio,
  getLuminance,
  lighten,
} from '@mui/material/styles';

/** WCAG AA contrast for text of the size used in actions. */
const minimumContrast = 4.5;

/**
 * Adjusts the Element theme where action text is hard to read, which is the
 * case in its dark theme. Colors that already contrast enough stay unchanged,
 * and so does the primary color that marks navigation, selection and focus.
 */
export function calendarActionContrast(theme: Theme): ThemeOptions {
  const { action, background, mode, primary, error, text, divider } =
    theme.palette;
  // Every surface an action sits on, including its hover and focus tint.
  const surfaces = [background.default, background.paper];
  const tinted = (tint: string, opacity: number) =>
    surfaces.map((surface) => composite(tint, opacity, surface));

  const primaryText = readableColor(
    primary.main,
    [...surfaces, ...tinted(primary.main, action.hoverOpacity)],
    mode === 'dark' ? lighten : darken,
  );
  // Destructive menu items and error messages use the palette color directly.
  const errorText = readableColor(
    error.main,
    [...surfaces, ...tinted(text.primary, action.focusOpacity)],
    mode === 'dark' ? lighten : darken,
  );

  const filled = (color: { main: string; dark: string }, text: string) => {
    // Move away from the text color, whichever of the two is lighter.
    const away =
      getLuminance(text) > getLuminance(color.main) ? darken : lighten;
    const main = readableColor(color.main, [text], away);
    const hover = readableColor(color.dark, [text], away);
    return {
      main,
      hover: main === color.main ? hover : away(main, 0.1),
    };
  };
  const primaryFill = filled(primary, primary.contrastText);
  // The filled error color derives from the original, not the lighter text.
  const errorFill = filled(error, error.contrastText);
  const selected = {
    '&.Mui-selected, &.Mui-selected:hover, &.Mui-selected:focus': {
      backgroundColor: primaryFill.main,
    },
  };

  return {
    palette: { error: { main: errorText } },
    typography: {
      // Keeps picker headings in sentence case, like Element's buttons.
      overline: { textTransform: 'none' },
    },
    components: {
      MuiInputLabel: {
        styleOverrides: {
          root: {
            '&.Mui-focused:not(.Mui-error)': { color: primaryText },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: ({ ownerState }) => {
            const color = ownerState.color ?? 'primary';
            if (color !== 'primary' && color !== 'error') {
              return {};
            }

            if (ownerState.variant === 'contained') {
              const fill = color === 'primary' ? primaryFill : errorFill;
              return {
                backgroundColor: fill.main,
                '&:hover': {
                  backgroundColor: fill.hover,
                  '@media (hover: none)': { backgroundColor: fill.main },
                },
              };
            }

            return { color: color === 'primary' ? primaryText : errorText };
          },
        },
      },
      ...(primaryText !== primary.main && {
        MuiLink: { defaultProps: { color: primaryText } },
      }),
      ...(mode === 'dark' && {
        MuiPaper: {
          styleOverrides: {
            // MUI lightens raised dark surfaces, which Element doesn't do and
            // which leaves action text on dialogs and menus unreadable.
            root: ({ ownerState }) => ({
              ...(ownerState.variant !== 'outlined' && {
                backgroundImage: 'none',
              }),
              ...(ownerState.elevation === 8 && {
                // Keep the visual edge inside fixed-width picker surfaces.
                boxShadow: `inset 0 0 0 1px ${divider}, ${theme.shadows[8]}`,
              }),
            }),
          },
        },
      }),
      // The date pickers share the theme but don't extend its component types.
      ...({
        MuiPickersDay: { styleOverrides: { root: selected } },
        MuiPickersMonth: { styleOverrides: { monthButton: selected } },
        MuiPickersYear: { styleOverrides: { yearButton: selected } },
      } as ThemeOptions['components']),
    },
  };
}

/** The color, or the closest shade of it that contrasts with every surface. */
function readableColor(
  color: string,
  surfaces: string[],
  shade: (color: string, coefficient: number) => string,
): string {
  for (let step = 0; step < 100; step++) {
    const candidate = step === 0 ? color : shade(color, step / 100);
    if (
      surfaces.every(
        (surface) => getContrastRatio(candidate, surface) >= minimumContrast,
      )
    ) {
      return candidate;
    }
  }

  return shade(color, 1);
}

/** The opaque color of a translucent tint above an opaque surface. */
function composite(tint: string, opacity: number, surface: string): string {
  const below = decomposeColor(surface).values;
  const above = decomposeColor(alpha(tint, opacity)).values;
  const [red, green, blue] = [0, 1, 2].map((channel) =>
    Math.round(above[channel] * opacity + below[channel] * (1 - opacity)),
  );
  return `rgb(${red}, ${green}, ${blue})`;
}
