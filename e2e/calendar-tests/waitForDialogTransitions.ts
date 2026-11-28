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

import type { Locator } from '@playwright/test';

export async function waitForDialogTransitions(dialog: Locator): Promise<void> {
  await dialog.evaluate(async (element) => {
    const dialogRoot = element.closest('.MuiDialog-root');
    if (!dialogRoot) return;

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    const transitions = dialogRoot
      .getAnimations({ subtree: true })
      .filter((animation) => animation.constructor.name === 'CSSTransition');
    await Promise.all(
      transitions.map((transition) =>
        transition.finished.catch(() => undefined),
      ),
    );
  });
}
