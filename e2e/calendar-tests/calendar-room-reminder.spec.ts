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

import { expect, test } from '@playwright/test';

test('room manager can search and save an exact Matrix reminder recipient while membership updates', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(
    '/browser-tests/index.html?mode=room-manager&meetings_bot_user_id=%40calendar-bot%3Aexample.test',
  );

  await page.getByRole('button', { name: /Synthetic room planning/ }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Synthetic room planning',
  });
  await dialog
    .getByRole('button', { name: 'Reminder settings', exact: true })
    .click();
  await expect(
    dialog.getByText('Alarm 1: −15m relative to event start'),
  ).toBeVisible();

  await dialog.getByRole('combobox', { name: 'Matrix destination' }).click();
  await page.getByRole('option', { name: 'Selected people' }).click();
  const recipients = dialog.getByRole('combobox', {
    name: 'Selected people',
  });
  await recipients.click();
  await expect(page.getByRole('option', { name: 'Alice' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Bob' })).toBeVisible();
  await expect(
    page.getByRole('option', { name: 'Calendar bot', exact: true }),
  ).toHaveCount(0);
  await recipients.fill('@alice:example.test');

  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const controlsId = await recipients.evaluate((element) =>
    element.getAttribute('aria-controls'),
  );
  expect(controlsId).toBeTruthy();
  expect(await listbox.evaluate((element) => element.id)).toBe(controlsId);
  await expect(listbox.getByRole('option')).toHaveCount(1);
  await expect(
    listbox.getByRole('option', { name: 'Alice', exact: true }),
  ).toBeVisible();

  await page.evaluate(() => {
    window.__updateSyntheticRoomMember?.({
      type: 'm.room.member',
      room_id: '!synthetic-room:example.test',
      state_key: '@bob:example.test',
      content: { membership: 'join', displayname: 'Robert' },
    } as never);
  });

  await expect(recipients).toHaveValue('@alice:example.test');
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole('option')).toHaveCount(1);
  await expect(
    listbox.getByRole('option', { name: 'Alice', exact: true }),
  ).toBeVisible();

  await recipients.press('ArrowDown');
  await recipients.press('Enter');
  await expect(listbox).toBeHidden();
  await expect(dialog.locator('.MuiAutocomplete-tag')).toHaveText(['Alice']);
  await dialog
    .getByRole('button', { name: 'Save Matrix destination', exact: true })
    .click();
  await expect(
    dialog.getByText('Matrix pings the selected people.', { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.__syntheticRoomReminderTarget ?? null),
    )
    .toEqual({ kind: 'users', userIds: ['@alice:example.test'] });
});

declare global {
  interface Window {
    __updateSyntheticRoomMember?: (event: unknown) => void;
    __syntheticRoomReminderTarget?:
      | { kind: 'room' }
      | { kind: 'users'; userIds: string[] }
      | null;
  }
}
