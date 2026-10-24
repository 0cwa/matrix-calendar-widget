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

import { MuiThemeProvider as ElementMuiThemeProvider } from '@matrix-widget-toolkit/mui';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { PropsWithChildren } from 'react';

/**
 * Return an overlay container inside the body, including when the document
 * element itself enters fullscreen. MUI hides siblings of the portal
 * container from assistive technology, and the body must never be a hidden
 * sibling of an overlay.
 */
export function getCalendarOverlayContainer(): HTMLElement {
  const fullscreenElement = document.fullscreenElement;
  if (
    !fullscreenElement ||
    fullscreenElement === document.documentElement ||
    fullscreenElement === document.body
  ) {
    return document.body;
  }

  return fullscreenElement as HTMLElement;
}

export function CalendarMuiThemeProvider({ children }: PropsWithChildren<{}>) {
  return (
    <ElementMuiThemeProvider>
      <ThemeProvider
        theme={(outerTheme) =>
          createTheme(outerTheme, {
            components: {
              MuiDialog: {
                defaultProps: { container: getCalendarOverlayContainer },
              },
              MuiMenu: {
                defaultProps: { container: getCalendarOverlayContainer },
              },
              MuiPopover: {
                defaultProps: {
                  container: getCalendarOverlayContainer,
                  slotProps: {
                    root: { container: getCalendarOverlayContainer },
                  },
                },
              },
              MuiTooltip: {
                defaultProps: {
                  slotProps: {
                    popper: { container: getCalendarOverlayContainer },
                  },
                  PopperProps: { container: getCalendarOverlayContainer },
                },
              },
            },
          })
        }
      >
        {children}
      </ThemeProvider>
    </ElementMuiThemeProvider>
  );
}
