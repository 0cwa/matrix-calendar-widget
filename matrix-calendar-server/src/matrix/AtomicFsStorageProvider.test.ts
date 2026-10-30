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

import * as fs from 'node:fs';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AtomicFsStorageProvider,
  writeJsonAtomically,
} from './AtomicFsStorageProvider';

describe('AtomicFsStorageProvider', () => {
  let directory: string;
  let filename: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'matrix-sdk-storage-'));
    filename = path.join(directory, 'bot.json');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('persists the Matrix SDK file schema with private file permissions', () => {
    const storage = new AtomicFsStorageProvider(filename);

    storage.setSyncToken('sync-token-1');
    storage.setFilter({ id: 1, filter: {} });
    storage.storeValue('key', 'value');

    const saved = JSON.parse(readFileSync(filename, 'utf8'));
    expect(saved).toEqual({
      syncToken: 'sync-token-1',
      filter: { id: 1, filter: {} },
      appserviceUsers: {},
      appserviceTransactions: {},
      kvStore: { key: 'value' },
    });
    expect(statSync(filename).mode & 0o777).toBe(0o600);

    const reopened = new AtomicFsStorageProvider(filename);
    expect(reopened.getSyncToken()).toBe('sync-token-1');
    expect(reopened.getFilter()).toEqual({ id: 1, filter: {} });
    expect(reopened.readValue('key')).toBe('value');
  });

  it('preserves existing Matrix SDK state and unknown JSON fields', () => {
    fs.writeFileSync(
      filename,
      JSON.stringify({ syncToken: 'legacy-token', custom: { keep: true } }),
    );

    const storage = new AtomicFsStorageProvider(filename);
    storage.storeValue('key', 'value');

    expect(JSON.parse(readFileSync(filename, 'utf8'))).toEqual({
      syncToken: 'legacy-token',
      custom: { keep: true },
      filter: null,
      appserviceUsers: {},
      appserviceTransactions: {},
      kvStore: { key: 'value' },
    });
  });

  it('keeps the previous complete file when writing the replacement fails', () => {
    const storage = new AtomicFsStorageProvider(filename);
    storage.setSyncToken('previous-token');
    const previousContents = readFileSync(filename, 'utf8');
    expect(() =>
      writeJsonAtomically(
        filename,
        {
          ...JSON.parse(previousContents),
          syncToken: 'next-token',
        },
        {
          ...fs,
          renameSync: () => {
            throw new Error('synthetic rename failure');
          },
        },
      ),
    ).toThrow('synthetic rename failure');
    expect(readFileSync(filename, 'utf8')).toBe(previousContents);
    expect(fs.readdirSync(directory)).toEqual(['bot.json']);
  });

  it.each(['write', 'file fsync'])(
    'keeps the old file and removes the temporary file when %s fails',
    (failurePoint) => {
      const storage = new AtomicFsStorageProvider(filename);
      storage.setSyncToken('previous-token');
      const previousContents = readFileSync(filename, 'utf8');
      const fileSystem = {
        ...fs,
        ...(failurePoint === 'write'
          ? {
              writeFileSync: () => {
                throw new Error('synthetic write failure');
              },
            }
          : {
              fsyncSync: () => {
                throw new Error('synthetic fsync failure');
              },
            }),
      };

      expect(() =>
        writeJsonAtomically(
          filename,
          {
            ...JSON.parse(previousContents),
            syncToken: 'next-token',
          },
          fileSystem,
        ),
      ).toThrow(failurePoint === 'write' ? 'write failure' : 'fsync failure');
      expect(readFileSync(filename, 'utf8')).toBe(previousContents);
      expect(fs.readdirSync(directory)).toEqual(['bot.json']);
    },
  );

  it('reports when directory sync fails after the replacement is installed', () => {
    const storage = new AtomicFsStorageProvider(filename);
    storage.setSyncToken('previous-token');
    const previousContents = readFileSync(filename, 'utf8');
    let syncCount = 0;
    const fileSystem = {
      ...fs,
      fsyncSync: (descriptor: number) => {
        syncCount += 1;
        if (syncCount === 2)
          throw new Error('synthetic directory fsync failure');
        fs.fsyncSync(descriptor);
      },
    };

    expect(() =>
      writeJsonAtomically(
        filename,
        {
          ...JSON.parse(previousContents),
          syncToken: 'next-token',
        },
        fileSystem,
      ),
    ).toThrow(
      expect.objectContaining({
        name: 'AtomicJsonWriteError',
        targetReplaced: true,
      }),
    );
    expect(JSON.parse(readFileSync(filename, 'utf8')).syncToken).toBe(
      'next-token',
    );
    expect(fs.readdirSync(directory)).toEqual(['bot.json']);
  });

  it('allows a reader at rename time to see only the old or new JSON document', () => {
    const storage = new AtomicFsStorageProvider(filename);
    storage.setSyncToken('previous-token');
    const observations: string[] = [];
    writeJsonAtomically(
      filename,
      {
        ...JSON.parse(readFileSync(filename, 'utf8')),
        syncToken: 'next-token',
      },
      {
        ...fs,
        renameSync: (source, destination) => {
          observations.push(
            JSON.parse(readFileSync(destination, 'utf8')).syncToken,
          );
          fs.renameSync(source, destination);
          observations.push(
            JSON.parse(readFileSync(destination, 'utf8')).syncToken,
          );
        },
      },
    );

    expect(observations).toEqual(['previous-token', 'next-token']);
  });

  it('preserves namespaced Matrix SDK storage and appservice behavior', () => {
    const storage = new AtomicFsStorageProvider(filename, false);
    const userStorage = storage.storageForUser('@bot:example.org');

    storage.addRegisteredUser('@bot:example.org');
    storage.setTransactionCompleted('txn-1');
    userStorage.setSyncToken('user-sync-token');
    userStorage.storeValue('user-key', 'user-value');

    expect(storage.isUserRegistered('@bot:example.org')).toBe(true);
    expect(storage.isTransactionCompleted('txn-1')).toBe(true);
    expect(userStorage.getSyncToken()).resolves.toBe('user-sync-token');
    expect(userStorage.readValue('user-key')).toBe('user-value');
  });
});
