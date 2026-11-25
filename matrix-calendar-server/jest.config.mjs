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

import os from 'node:os';

export default {
  testEnvironment: 'node',
  automock: false,
  resetMocks: true,
  setupFiles: ['./setupJest.js'],
  preset: 'ts-jest',
  maxWorkers: Math.max(
    2,
    Math.min(8, Math.floor(os.availableParallelism() / 2)),
  ),
  verbose: true,
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  moduleDirectories: ['node_modules', 'lib'],
  testRegex: '(/__tests__/.*|\\.(test|spec))\\.(ts|tsx|js)$',
  moduleFileExtensions: ['ts', 'tsx', 'js'],
  setupFilesAfterEnv: ['<rootDir>/setupTests.ts'],
  roots: ['<rootDir>/src', '<rootDir>/test'],
  moduleNameMapper: {
    '@matrix-calendar-widget/(.*)': '<rootDir>/../packages/$1/src/index.ts',
  },
};
