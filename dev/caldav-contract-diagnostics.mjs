// Copyright 2026 Matrix Calendar Widget contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const safeSuiteBasename =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\.test\.(?:js|mjs|ts|tsx)$/;
const safeStaticTitle = /^[A-Za-z0-9][A-Za-z0-9 _.,:()/'+-]{0,159}$/;
const safeAssertionFrame = /(?:^|[ (])(?:.*[\\/])?(?:matrix-calendar-server[\\/])?test[\\/]integration[\\/]CalDavEventRoundTripContract\.test\.ts:(\d+):(\d+)\)?(?=\s|$)/;

function hasStaticTitle(source, title) {
  const singleQuoted = `'${title.replaceAll("'", "\\'")}'`;
  const doubleQuoted = JSON.stringify(title);

  return source.includes(singleQuoted) || source.includes(doubleQuoted);
}

export function formatFailedCalDavTestIdentities(
  testReport,
  repoRoot = process.cwd(),
) {
  const identities = [];

  for (const suite of testReport.testResults ?? []) {
    if (suite.status !== 'failed' || typeof suite.name !== 'string') {
      continue;
    }

    const suitePath = path.resolve(repoRoot, suite.name);
    const relativePath = path.relative(repoRoot, suitePath);
    const pathParts = relativePath.split(path.sep);
    const suiteBasename = path.basename(suitePath);
    if (
      pathParts[0] !== 'matrix-calendar-server' ||
      pathParts[1] !== 'test' ||
      pathParts.includes('..') ||
      !safeSuiteBasename.test(suiteBasename)
    ) {
      continue;
    }

    let suiteSource;
    try {
      suiteSource = readFileSync(suitePath, 'utf8');
    } catch {
      continue;
    }

    for (const test of suite.assertionResults ?? []) {
      const line = test.location?.line;
      const column = test.location?.column;
      if (
        test.status !== 'failed' ||
        !Number.isInteger(line) ||
        line < 1 ||
        !Number.isInteger(column) ||
        column < 1
      ) {
        continue;
      }

      const title = test.title;
      const staticTitle =
        typeof title === 'string' &&
        safeStaticTitle.test(title) &&
        hasStaticTitle(suiteSource, title)
          ? title
          : '(static title withheld)';
      const assertionLocations = new Set();
      if (
        pathParts.join(path.sep) ===
        path.join(
          'matrix-calendar-server',
          'test',
          'integration',
          'CalDavEventRoundTripContract.test.ts',
        )
      ) {
        for (const message of test.failureMessages ?? []) {
          if (typeof message !== 'string') {
            continue;
          }
          for (const stackLine of message.split(/\r?\n/)) {
            if (!/^\s*at\s/.test(stackLine)) {
              continue;
            }
            const match = stackLine.match(safeAssertionFrame);
            if (!match) {
              continue;
            }
            const assertionLine = Number(match[1]);
            const assertionColumn = Number(match[2]);
            const sourceLine = suiteSource.split(/\r?\n/)[assertionLine - 1];
            if (
              Number.isInteger(assertionLine) &&
              assertionLine > 0 &&
              Number.isInteger(assertionColumn) &&
              assertionColumn > 0 &&
              typeof sourceLine === 'string' &&
              assertionColumn <= sourceLine.length + 1
            ) {
              assertionLocations.add(`${assertionLine}:${assertionColumn}`);
            }
          }
        }
      }
      identities.push({
        suiteBasename,
        line,
        column,
        staticTitle,
        assertionLocations: [...assertionLocations],
      });
    }
  }

  return identities;
}
