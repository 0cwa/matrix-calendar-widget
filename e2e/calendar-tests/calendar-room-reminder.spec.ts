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

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { waitForDialogTransitions } from './waitForDialogTransitions';

for (const theme of ['light', 'dark']) {
  test(`saved and draft notification status is accessible at 360 pixels in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(
      `/browser-tests/index.html?mode=room-manager&theme=${theme}&meetings_bot_user_id=%40calendar-bot%3Aexample.test`,
    );
    await page.getByRole('button', { name: /Synthetic room planning/ }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Synthetic room planning',
    });
    const toggle = dialog.getByRole('button', {
      name: 'Matrix room notifications',
      exact: true,
    });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog.getByTestId('room-reminder-summary')).toHaveText('Off');
    await waitForDialogTransitions(dialog);
    const collapsed = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(collapsed.violations).toEqual([]);

    await toggle.click();
    await expect(
      dialog.getByRole('button', { name: 'Close Matrix room notifications' }),
    ).toHaveAttribute('aria-expanded', 'true');
    await dialog
      .getByRole('combobox', { name: 'Who to notify in this room' })
      .click();
    await page.getByRole('option', { name: 'Selected people' }).click();
    const recipients = dialog.getByRole('combobox', {
      name: 'Selected people',
    });
    await recipients.fill('Alice');
    await page.getByRole('option', { name: 'Alice', exact: true }).click();
    await expect(dialog.getByTestId('room-reminder-status')).toHaveText([
      /^Unsaved change: Matrix will ping Alice in this room/,
    ]);
    await expect(
      dialog.getByText(/Everyone in the room can still read the message/i),
    ).toBeVisible();
    await waitForDialogTransitions(dialog);
    const expanded = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(expanded.violations).toEqual([]);
    const bounds = await dialog.evaluate((element) => ({
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width + 1);
  });
}

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
  await expect(dialog.getByTestId('room-reminder-summary')).toHaveText('Off');
  await dialog
    .getByRole('button', { name: 'Matrix room notifications', exact: true })
    .click();
  await expect(
    dialog.getByText(
      'Calendar app alert 1: 15 minutes before the event starts',
    ),
  ).toBeVisible();

  await dialog
    .getByRole('combobox', { name: 'Who to notify in this room' })
    .click();
  await page.getByRole('option', { name: 'Selected people' }).click();
  const recipients = dialog.getByRole('combobox', {
    name: 'Selected people',
  });
  const modalRoot = page.locator('.MuiDialog-root').last();
  await recipients.click();
  await expect(page.getByRole('option', { name: 'Alice' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Bob' })).toBeVisible();
  const popper = modalRoot.locator('.MuiAutocomplete-popper');
  const listbox = modalRoot.getByRole('listbox');
  await expect(popper).toBeVisible();
  await expect(listbox).toBeVisible();
  expect(
    await listbox.evaluate((element) =>
      Boolean(element.closest('[aria-hidden="true"]')),
    ),
  ).toBe(false);
  const popperBounds = await popper.boundingBox();
  expect(popperBounds).not.toBeNull();
  expect(popperBounds!.x).toBeGreaterThanOrEqual(0);
  expect(popperBounds!.y).toBeGreaterThanOrEqual(0);
  expect(popperBounds!.x + popperBounds!.width).toBeLessThanOrEqual(1280);
  expect(popperBounds!.y + popperBounds!.height).toBeLessThanOrEqual(900);
  await expect(
    page.getByRole('option', { name: 'Calendar bot', exact: true }),
  ).toHaveCount(0);
  await recipients.fill('@alice:example.test');

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
    window.__updateSyntheticRoomMember({
      type: 'm.room.member',
      room_id: '!synthetic-room:example.test',
      state_key: '@alice:example.test',
      content: { membership: 'join', displayname: 'Alicia' },
    } as never);
    window.__updateSyntheticRoomMember({
      type: 'm.room.member',
      room_id: '!synthetic-room:example.test',
      state_key: '@bob:example.test',
      content: { membership: 'join', displayname: 'Robert' },
    } as never);
  });

  await expect(
    listbox.getByRole('option', { name: 'Alicia', exact: true }),
  ).toBeVisible();
  await expect(recipients).toHaveValue('@alice:example.test');
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole('option')).toHaveCount(1);
  await expect(
    listbox.getByRole('option', { name: 'Alicia', exact: true }),
  ).toBeVisible();

  await recipients.press('ArrowDown');
  await recipients.press('Enter');
  await expect(listbox).toBeHidden();
  await expect(dialog.locator('.MuiAutocomplete-tag')).toHaveText(['Alicia']);
  await recipients.click();
  await expect(
    page.getByRole('option', { name: 'Robert', exact: true }),
  ).toBeVisible();
  await recipients.press('Escape');
  await dialog
    .getByRole('button', { name: 'Save room notification', exact: true })
    .click();
  await expect(
    dialog
      .getByTestId('room-reminder-status')
      .filter({ hasText: /^Saved: Matrix pings .+ in this room/ }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.__syntheticRoomReminderTarget ?? null),
    )
    .toEqual({ kind: 'users', userIds: ['@alice:example.test'] });
  await expect(dialog.getByTestId('room-reminder-status')).toHaveCount(1);
  await dialog
    .getByRole('button', { name: 'Close Matrix room notifications' })
    .click();
  await expect(dialog.getByTestId('room-reminder-summary')).toHaveText(
    '1 selected person',
  );
});

declare global {
  interface Window {
    __updateSyntheticRoomMember: (event: unknown) => void;
    __syntheticRoomReminderTarget?:
      { kind: 'room' } | { kind: 'users'; userIds: string[] } | null;
  }
}

test('all-day notification time zones are searchable inside Event Details', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-01T10:00:00.000Z'));
  await page.setViewportSize({ width: 420, height: 740 });
  await page.goto(
    '/browser-tests/index.html?mode=room-manager&all-day=1&theme=dark&meetings_bot_user_id=%40calendar-bot%3Aexample.test',
  );
  await page.getByRole('button', { name: /Synthetic room planning/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic room planning' });
  await dialog
    .getByRole('button', { name: 'Matrix room notifications', exact: true })
    .click();
  await dialog
    .getByRole('combobox', { name: 'Who to notify in this room' })
    .click();
  await page.getByRole('option', { name: 'Whole room', exact: true }).click();
  const timezone = dialog.getByRole('combobox', {
    name: 'Notification time zone',
  });
  await timezone.fill('berlin');
  const modalRoot = page.locator('.MuiDialog-root').last();
  const listbox = modalRoot.getByRole('listbox');
  await expect(
    listbox.getByRole('option', { name: 'Europe/Berlin', exact: true }),
  ).toBeVisible();
  await waitForDialogTransitions(dialog);
  const suggestions = await new AxeBuilder({ page })
    .include('.MuiDialog-root')
    .analyze();
  expect(suggestions.violations).toEqual([]);
  await timezone.press('ArrowDown');
  await timezone.press('Enter');
  await expect(timezone).toHaveValue('Europe/Berlin');
  await expect(listbox).toBeHidden();

  await timezone.fill('new york');
  await expect(
    listbox.getByRole('option', { name: 'America/New_York', exact: true }),
  ).toBeVisible();
  await timezone.press('ArrowDown');
  await timezone.press('Enter');
  await expect(timezone).toHaveValue('America/New_York');
  await dialog
    .getByRole('button', { name: 'Save room notification', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __syntheticRoomReminderSchedule?: { timezone: string };
            }
          ).__syntheticRoomReminderSchedule?.timezone,
      ),
    )
    .toBe('America/New_York');
});
