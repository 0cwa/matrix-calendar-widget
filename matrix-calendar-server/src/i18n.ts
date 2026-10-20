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

import i18next from 'i18next';
import i18nextFsBackend from 'i18next-fs-backend';
import i18nextMiddleware from 'i18next-http-middleware';
import { registerDateRangeFormatter } from './dateRangeFormatter';

export async function initializeI18next(
  supportedLngs: string[],
): Promise<void> {
  await i18next
    .use(i18nextFsBackend)
    .use(i18nextMiddleware.LanguageDetector)
    .init({
      fallbackLng: 'en',
      backend: {
        loadPath: `${__dirname}/static/locales/{{lng}}/{{ns}}.json`,
      },
      debug: false,
      saveMissing: true,
      detection: {
        order: ['header', 'querystring', 'cookie'],
        caches: ['cookie'],
      },
      preload: supportedLngs,
    });

  registerDateRangeFormatter(i18next);
}
