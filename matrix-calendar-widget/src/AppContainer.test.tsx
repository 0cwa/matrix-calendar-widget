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

import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { render, screen } from '@testing-library/react';
import AppContainer from './AppContainer';

vi.mock('@matrix-widget-toolkit/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@matrix-widget-toolkit/api')>()),
  extractRawWidgetParameters: () => ({}),
}));

describe('AppContainer', () => {
  it('shows an accessible configuration error instead of an in-memory calendar', () => {
    render(
      <AppContainer widgetApiPromise={Promise.resolve({} as WidgetApi)} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Calendar configuration is incomplete.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A Matrix room ID and calendar API URL are required.',
    );
  });
});
