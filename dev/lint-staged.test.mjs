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

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { lintStaged } from './lint-staged.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('staged lint runs configured ESLint on supplied paths and reports defects', async () => {
  const temporaryDirectory = mkdtempSync(
    resolve(ROOT, 'dev', 'staged lint test-'),
  );
  const validTool = resolve(temporaryDirectory, 'valid tool.mjs');
  const invalidTool = resolve(temporaryDirectory, 'invalid tool.mjs');
  const invalidSyntaxTool = resolve(temporaryDirectory, 'invalid syntax.mjs');
  const toolingPath = 'dev/element-acceptance-workflow.test.mjs';
  const workspacePath = resolve(
    ROOT,
    'matrix-calendar-widget/src/AppContainer.test.tsx',
  );

  try {
    writeFileSync(
      validTool,
      'export const stagedProbe = process.platform.length > 0;\n',
    );
    writeFileSync(invalidTool, 'const stagedProbe = true;\n');
    writeFileSync(invalidSyntaxTool, 'export const syntaxProbe = ;\n');

    const valid = await lintStaged([toolingPath, validTool, workspacePath]);
    assert.equal(valid.status, 0, valid.output);

    const invalid = await lintStaged([invalidTool]);
    assert.notEqual(invalid.status, 0, 'unused variable must fail lint');
    assert.match(invalid.output, /no-unused-vars/u);

    const invalidSyntax = await lintStaged([invalidSyntaxTool]);
    assert.notEqual(invalidSyntax.status, 0, 'syntax errors must fail lint');
    assert.match(invalidSyntax.output, /Parsing error/u);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('staged lint preserves the E2E workspace warning policy', async () => {
  const temporaryDirectory = mkdtempSync(
    resolve(ROOT, 'e2e', 'staged lint warning test-'),
  );
  const warningFile = resolve(temporaryDirectory, 'warning.spec.ts');

  try {
    writeFileSync(
      warningFile,
      `/*
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

import { test } from '@playwright/test';

test('warning-only staged probe', async ({ page }) => {
  if (page) {
    await page.title();
  }
});
`,
    );

    const result = spawnSync(
      process.execPath,
      [resolve(ROOT, 'dev/lint-staged.mjs'), warningFile],
      { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /playwright\/no-conditional-in-test/u);
    assert.match(result.stdout, /0 errors, \d+ warnings/u);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
