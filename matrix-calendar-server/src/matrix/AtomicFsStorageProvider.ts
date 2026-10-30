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

import {
  IAppserviceStorageProvider,
  IFilterInfo,
  IStorageProvider,
} from 'matrix-bot-sdk';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

type StorageDatabase = {
  syncToken?: string | null;
  filter?: IFilterInfo | null;
  appserviceUsers?: Record<string, { userId?: string; registered?: boolean }>;
  appserviceTransactions?: Record<
    string,
    { txnId?: string; completed?: boolean }
  >;
  kvStore?: Record<string, string | null | undefined>;
};

function createDefaultDatabase(): Required<StorageDatabase> {
  return {
    syncToken: null,
    filter: null,
    appserviceUsers: {},
    appserviceTransactions: {},
    kvStore: {},
  };
}

/**
 * Matrix SDK file storage whose complete JSON document is committed with a
 * same-directory atomic rename. A live file copy therefore sees either the
 * previous or next complete document, never an in-place partial write.
 */
export class AtomicFsStorageProvider
  implements IStorageProvider, IAppserviceStorageProvider
{
  private readonly database: Required<StorageDatabase>;
  private completedTransactions: string[] = [];

  constructor(
    private readonly filename: string,
    private readonly trackTransactionsInMemory = true,
    private readonly maxInMemoryTransactions = 20,
  ) {
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.database = this.readDatabase();
    this.writeDatabase();
  }

  setSyncToken(token: string | null): void {
    this.database.syncToken = token;
    this.writeDatabase();
  }

  getSyncToken(): string | null {
    return this.database.syncToken;
  }

  setFilter(filter: IFilterInfo): void {
    this.database.filter = filter;
    this.writeDatabase();
  }

  getFilter(): IFilterInfo {
    return this.database.filter as IFilterInfo;
  }

  addRegisteredUser(userId: string): void {
    const key = this.hash(userId);
    this.database.appserviceUsers[key] = { userId, registered: true };
    this.writeDatabase();
  }

  isUserRegistered(userId: string): boolean {
    return Boolean(
      this.database.appserviceUsers[this.hash(userId)]?.registered,
    );
  }

  isTransactionCompleted(transactionId: string): boolean {
    if (this.trackTransactionsInMemory) {
      return this.completedTransactions.includes(transactionId);
    }

    return (
      this.database.appserviceTransactions[this.hash(transactionId)]
        ?.completed ?? false
    );
  }

  setTransactionCompleted(transactionId: string): void {
    if (this.trackTransactionsInMemory) {
      if (!this.completedTransactions.includes(transactionId)) {
        this.completedTransactions.push(transactionId);
      }
      if (this.completedTransactions.length > this.maxInMemoryTransactions) {
        this.completedTransactions = this.completedTransactions
          .reverse()
          .slice(0, this.maxInMemoryTransactions)
          .reverse();
      }
      return;
    }

    this.database.appserviceTransactions[this.hash(transactionId)] = {
      txnId: transactionId,
      completed: true,
    };
    this.writeDatabase();
  }

  readValue(key: string): string | null | undefined {
    return this.database.kvStore[key];
  }

  storeValue(key: string, value: string | null): void {
    this.database.kvStore[key] = value;
    this.writeDatabase();
  }

  storageForUser(userId: string): IStorageProvider {
    return new NamespacedStorageProvider(userId, this);
  }

  private readDatabase(): Required<StorageDatabase> {
    let database: StorageDatabase = {};
    if (existsSync(this.filename)) {
      const contents = readFileSync(this.filename, 'utf8').trim();
      if (contents) {
        database = JSON.parse(contents) as StorageDatabase;
      }
    }

    if (!database || typeof database !== 'object' || Array.isArray(database)) {
      throw new Error('Matrix SDK storage file must contain a JSON object');
    }

    for (const [key, defaultValue] of Object.entries(createDefaultDatabase())) {
      if (database[key as keyof StorageDatabase] === undefined) {
        Object.assign(database, { [key]: defaultValue });
      }
    }

    return database as Required<StorageDatabase>;
  }

  private writeDatabase(): void {
    writeJsonAtomically(this.filename, this.database);
  }

  private hash(value: string): string {
    return createHash('sha512').update(value).digest('hex');
  }
}

class NamespacedStorageProvider implements IStorageProvider {
  constructor(
    private readonly prefix: string,
    private readonly parent: AtomicFsStorageProvider,
  ) {}

  setFilter(filter: IFilterInfo): void {
    this.parent.storeValue(`${this.prefix}_int_filter`, JSON.stringify(filter));
  }

  getFilter(): Promise<IFilterInfo> {
    return Promise.resolve(
      this.parent.readValue(`${this.prefix}_int_filter`),
    ).then((value) =>
      value ? JSON.parse(value) : value,
    ) as Promise<IFilterInfo>;
  }

  setSyncToken(token: string | null): void {
    this.parent.storeValue(`${this.prefix}_int_syncToken`, token);
  }

  getSyncToken(): Promise<string | null> {
    return Promise.resolve(
      this.parent.readValue(`${this.prefix}_int_syncToken`),
    ).then((value) => value ?? null);
  }

  readValue(key: string): string | null | undefined {
    return this.parent.readValue(`${this.prefix}_kv_${key}`);
  }

  storeValue(key: string, value: string): void {
    this.parent.storeValue(`${this.prefix}_kv_${key}`, value);
  }
}

type AtomicFileSystem = Pick<
  typeof fs,
  | 'closeSync'
  | 'fsyncSync'
  | 'openSync'
  | 'renameSync'
  | 'unlinkSync'
  | 'writeFileSync'
>;

export function writeJsonAtomically(
  filename: string,
  value: unknown,
  fileSystem: AtomicFileSystem = fs,
): void {
  const directory = dirname(filename);
  const temporaryPath = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  const contents = JSON.stringify(value, null, 2);
  let descriptor: number | undefined;

  try {
    descriptor = fileSystem.openSync(temporaryPath, 'wx', 0o600);
    fileSystem.writeFileSync(descriptor, contents, 'utf8');
    fileSystem.fsyncSync(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = undefined;
    fileSystem.renameSync(temporaryPath, filename);

    const directoryDescriptor = fileSystem.openSync(directory, 'r');
    try {
      fileSystem.fsyncSync(directoryDescriptor);
    } finally {
      fileSystem.closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== undefined) fileSystem.closeSync(descriptor);
    try {
      fileSystem.unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created or may already be renamed.
    }
    throw error;
  }
}
