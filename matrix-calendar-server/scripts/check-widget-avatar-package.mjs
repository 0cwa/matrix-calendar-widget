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
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const { WidgetClient } = require('../lib/src/client/WidgetClient.js');
const { WidgetType } = require('../lib/src/model/WidgetType.js');

async function main() {
  const uploadedContent = [];
  const client = {
    async uploadContent(content, contentType) {
      uploadedContent.push({ content: Buffer.from(content), contentType });
      return 'mxc://example.org/calendar-avatar';
    },
  };
  const appConfig = {
    meetingwidget_url: 'https://calendar.example/widget',
    meetingwidget_name: 'Calendar',
  };
  const widgetClient = new WidgetClient(
    client,
    appConfig,
    {},
    {
      allWidgetIds: [],
      widgetContents: [],
    },
  );
  const widgetContent = await widgetClient.getMeetingWidgetEventContentAsync(
    `${WidgetType.MEETINGS}-avatar-packaging-smoke`,
  );

  assert.deepEqual(widgetContent, {
    id: `${WidgetType.MEETINGS}-avatar-packaging-smoke`,
    type: WidgetType.MEETINGS,
    url: appConfig.meetingwidget_url,
    name: appConfig.meetingwidget_name,
    avatar_url: 'mxc://example.org/calendar-avatar',
  });
  assert.equal(uploadedContent.length, 1);

  const [avatar] = uploadedContent;
  assert.equal(avatar.contentType, 'image/png');
  assert.equal(
    avatar.content.subarray(0, 8).toString('hex'),
    '89504e470d0a1a0a',
  );
  assert.equal(avatar.content.length, 1204);
  assert.equal(
    createHash('sha256').update(avatar.content).digest('hex'),
    'c2d752e473e4e278e213970aa5d89cbcf6a991eb5343317e88e2bdc3f30490b0',
  );

  console.log('Compiled WidgetClient uploaded its packaged calendar avatar.');
}

main().catch((error) => {
  console.error('Compiled calendar widget avatar is unavailable:', error);
  process.exitCode = 1;
});
