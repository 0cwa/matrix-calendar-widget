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

import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './calendar-tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['line']],
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:4174',
    timezoneId: 'Europe/Stockholm',
    locale: 'en-US',
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  outputDir: './calendar-test-results',
  webServer: {
    command:
      'yarn workspace @matrix-calendar-widget/widget vite --host 127.0.0.1 --port 4174 --strictPort',
    cwd: path.resolve(__dirname, '..'),
    url: 'http://127.0.0.1:4174/browser-tests/index.html',
    timeout: 30_000,
    reuseExistingServer: false,
  },
});
