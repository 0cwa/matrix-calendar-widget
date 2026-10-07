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

import type { PlaywrightTestConfig } from '@playwright/test';
import { devices } from '@playwright/test';

const config: PlaywrightTestConfig = {
  testDir: './src',
  testMatch: 'elementDesktopCalendarAcceptance.spec.ts',
  timeout: 150_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'line',
  outputDir:
    process.env.ELEMENT_DESKTOP_JOURNEY_PLAYWRIGHT_OUTPUT ??
    '/tmp/element-desktop-journey-playwright',
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    timezoneId: 'Europe/Stockholm',
    locale: 'en-US',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    baseURL: 'http://127.0.0.1:8090',
  },
};

export default config;
