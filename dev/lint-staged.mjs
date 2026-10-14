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

import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceConfigs = [
  ['matrix-calendar-widget/', 'matrix-calendar-widget/eslint.config.mjs'],
  ['matrix-calendar-server/', 'matrix-calendar-server/eslint.config.mjs'],
  ['e2e/', 'e2e/eslint.config.mjs'],
  ['packages/calendar/', 'packages/calendar/eslint.config.mjs'],
  ['packages/ical-timezones/', 'packages/ical-timezones/eslint.config.mjs'],
];

function resolveConfig(file) {
  if (file.startsWith('dev/') || file.startsWith('scripts/')) {
    return 'dev/eslint.config.mjs';
  }

  const workspace = workspaceConfigs.find(([prefix]) =>
    file.startsWith(prefix),
  );
  if (!workspace) {
    throw new Error(`No staged lint configuration for ${file}`);
  }
  return workspace[1];
}

export async function lintStaged(filesToLint) {
  const groups = new Map();
  for (const argument of filesToLint) {
    const absoluteFile = isAbsolute(argument)
      ? argument
      : resolve(ROOT, argument);
    const file = relative(ROOT, absoluteFile);
    if (file.startsWith('..') || file === '') {
      throw new Error('Staged lint paths must be inside the repository');
    }

    const config = resolveConfig(file);
    const files = groups.get(config) ?? [];
    files.push(absoluteFile);
    groups.set(config, files);
  }

  let failed = false;
  const outputs = [];
  for (const [config, files] of groups) {
    const configPath = resolve(ROOT, config);
    const requireFromConfig = createRequire(configPath);
    const { ESLint } = requireFromConfig('eslint');
    const eslint = new ESLint({
      cwd: ROOT,
      overrideConfigFile: configPath,
      overrideConfig: {
        languageOptions: {
          parserOptions: {
            tsconfigRootDir: dirname(configPath),
          },
        },
      },
      warnIgnored: false,
    });
    const results = await eslint.lintFiles(files);
    const formatter = await eslint.loadFormatter('stylish');
    outputs.push(formatter.format(results));
    if (results.some((result) => result.errorCount > 0)) {
      failed = true;
      break;
    }
  }

  return { status: failed ? 1 : 0, output: outputs.filter(Boolean).join('\n') };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await lintStaged(process.argv.slice(2));
  if (result.output) process.stdout.write(result.output);
  process.exitCode = result.status;
}
