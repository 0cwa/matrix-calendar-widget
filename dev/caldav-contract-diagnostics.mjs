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
const periodRemoveTestTitle =
  'removes one PERIOD RDATE from a serialized CalDAV resource with its current ETag';
const safePeriodStages = new Set([
  'period-test-start',
  'seed-put-4xx',
  'seed-put-5xx',
  'seed-put-transport',
  'seed-put-other-status',
  'period-resource-created',
  'period-resource-read',
  'period-resource-parsed',
  'period-target-validated',
  'period-target-is-duration',
  'period-patch-applied',
  'period-update-accepted',
  'period-updated-resource-read',
  'period-updated-resource-parsed',
  'period-rdate-count',
  'period-duration-removed',
  'period-end-sibling-preserved',
  'period-point-sibling-preserved',
  'period-vtimezone-preserved',
  'period-exdate-preserved',
  'period-detached-member-preserved',
  'period-unknown-properties-preserved',
]);

function hasStaticTitle(source, title) {
  const singleQuoted = `'${title.replaceAll("'", "\\'")}'`;
  const doubleQuoted = JSON.stringify(title);

  return source.includes(singleQuoted) || source.includes(doubleQuoted);
}

export function formatFailedCalDavTestIdentities(
  testReport,
  repoRoot = process.cwd(),
  stageReport = '',
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
      let safePeriodStage = null;
      if (
        pathParts.join(path.sep) ===
          path.join(
            'matrix-calendar-server',
            'test',
            'integration',
            'CalDavEventRoundTripContract.test.ts',
          ) &&
        title === periodRemoveTestTitle
      ) {
        for (const stageLine of stageReport.split(/\r?\n/)) {
          if (safePeriodStages.has(stageLine)) {
            safePeriodStage = stageLine;
          }
        }
      }
      identities.push({
        suiteBasename,
        line,
        column,
        staticTitle,
        safePeriodStage,
      });
    }
  }

  return identities;
}
