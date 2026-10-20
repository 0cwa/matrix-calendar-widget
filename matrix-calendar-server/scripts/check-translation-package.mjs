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

import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import i18nextModule from '../lib/src/i18n.js';

const { initializeI18next, i18next } = i18nextModule;

async function main() {
  await initializeI18next(['en', 'de']);

  const help = i18next.t('calendarCommandHelp', {
    lng: 'en',
    joinArrays: '\n',
  });

  assert.equal(typeof help, 'string');
  assert.match(help, /Room calendar commands/);
  assert.match(help, /!calendar setup/);
  assert.notEqual(help, 'calendarCommandHelp');
  console.log('Built English calendar help translation loaded successfully.');
}

main().catch((error) => {
  console.error('Built server translations are unavailable:', error);
  process.exitCode = 1;
});
