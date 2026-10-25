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

import { afterEach, describe, expect, it } from 'vitest';
import { getCalendarOverlayContainer } from './CalendarMuiThemeProvider';

const fullscreenElementDescriptor = Object.getOwnPropertyDescriptor(
  document,
  'fullscreenElement',
);
let innerFullscreenElement: HTMLElement | undefined;

function setFullscreenElement(element: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    value: element,
  });
}

afterEach(() => {
  innerFullscreenElement?.remove();
  innerFullscreenElement = undefined;
  if (fullscreenElementDescriptor) {
    Object.defineProperty(
      document,
      'fullscreenElement',
      fullscreenElementDescriptor,
    );
  } else {
    Reflect.deleteProperty(document, 'fullscreenElement');
  }
});

describe('getCalendarOverlayContainer', () => {
  it.each([
    ['without fullscreen', null],
    ['with the document element fullscreen', document.documentElement],
    ['with the body fullscreen', document.body],
  ])('uses the body %s', (_caseName, fullscreenElement) => {
    setFullscreenElement(fullscreenElement);

    expect(getCalendarOverlayContainer()).toBe(document.body);
  });

  it('uses an inner fullscreen app element', () => {
    innerFullscreenElement = document.createElement('main');
    document.body.append(innerFullscreenElement);
    setFullscreenElement(innerFullscreenElement);

    expect(getCalendarOverlayContainer()).toBe(innerFullscreenElement);
  });
});
