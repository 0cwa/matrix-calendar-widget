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
import { expect, test, type Page } from '@playwright/test';

test('the editor keeps its actions visible and explains alert choices', async ({
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 740 });
  await page.goto('/browser-tests/index.html?mode=room-manager&theme=dark');
  await page.getByRole('button', { name: 'Create event', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Create event' });
  const create = editor.getByRole('button', {
    name: 'Create event',
    exact: true,
  });
  const cancel = editor.getByRole('button', { name: 'Cancel', exact: true });
  await expect(create).toBeDisabled();
  await expect(create).toHaveAccessibleDescription('A title is required.');
  await expect(editor.getByRole('alert')).toHaveCount(0);
  const before = await cancel.boundingBox();
  expect(before).not.toBeNull();
  await expectDialogAccessibility(page);

  const title = editor.getByRole('textbox', { name: /^Title/ });
  await title.focus();
  await title.press('Tab');
  await expect(editor.getByRole('alert')).toHaveText('A title is required.');
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expectDialogAccessibility(page);

  await title.fill('Synthetic alert review');
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await expect(create).toBeEnabled();
  await editor.getByLabel('Calendar app alert').check();
  await expect(editor.getByRole('button', { name: '15 min' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await editor.getByRole('button', { name: '1 hour' }).click();
  await expect(editor.getByRole('button', { name: '1 hour' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectDialogAccessibility(page);
  await editor.getByRole('button', { name: 'Custom' }).click();
  await expect(
    editor.getByRole('spinbutton', { name: 'Lead time' }),
  ).toHaveValue('1');
  await expect(editor.getByRole('combobox', { name: 'Unit' })).toHaveValue(
    'alarmHours',
  );
  await expectDialogAccessibility(page);

  await editor.getByRole('radio', { name: 'At an exact UTC time' }).check();
  const exactTime = editor.getByLabel('Exact time (UTC)');
  await expect(exactTime).toHaveAttribute('type', 'datetime-local');
  await exactTime.fill('2026-10-01T08:45:30');
  await expect(exactTime).toHaveValue('2026-10-01T08:45:30');
  await expect(
    editor.getByText(/^Your time \(Europe\/Stockholm\):/),
  ).toBeVisible();
  await expect(create).toBeEnabled();
  await expectDialogAccessibility(page);
  const after = await cancel.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.y).toBeLessThan(740);
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
});

test('the editor displays every saved multi-unit alert value', async ({
  page,
}) => {
  await page.setViewportSize({ width: 850, height: 740 });
  await page.goto('/browser-tests/index.html?mode=room-manager&multi-alert=1');
  await page.getByRole('button', { name: /Synthetic room planning/ }).click();
  const details = page.getByRole('dialog', { name: 'Synthetic room planning' });
  await details.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit event' });
  await expect(editor.getByRole('button', { name: 'Custom' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    editor.getByRole('spinbutton', { name: 'Days before' }),
  ).toHaveValue('1');
  await expect(
    editor.getByRole('spinbutton', { name: 'Hours before' }),
  ).toHaveValue('2');
  await expect(
    editor.getByRole('spinbutton', { name: 'Minutes before' }),
  ).toHaveValue('30');
  await expectDialogAccessibility(page);
});

async function expectDialogAccessibility(page: Page) {
  const result = await new AxeBuilder({ page })
    .include('.MuiDialog-root')
    .analyze();
  expect(result.violations).toEqual([]);
}
