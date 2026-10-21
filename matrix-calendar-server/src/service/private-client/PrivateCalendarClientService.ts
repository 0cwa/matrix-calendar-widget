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
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { CalDavCredentialProvider } from '../../caldav/CalDavCredentialProvider';
import type { MatrixOpenIdCalDavCredentialProviderFactory } from '../../caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import type { IAppConfiguration } from '../../IAppConfiguration';
import type { IMatrixOpenIdCredential } from '../../model/IMatrixOpenIdCredential';
import {
  type NewPrivateCalendarClientRecord,
  PRIVATE_CALENDAR_CLIENT_LIMITS,
  type PrivateCalendarClientRecord,
  type PrivateCalendarClientStore,
  type PrivateCalendarClientTarget,
} from '../../model/IPrivateCalendarClientStore';
import type { IUserContext } from '../../model/IUserContext';
import type { MatrixCalendarAuthorizationFactory } from '../MatrixCalendarAuthorization';
import { isMatrixUserId } from '../MatrixIdentifiers';
import type { RoomCalendarCalDavAccess } from '../RoomCalendarCalDavAccess';
import {
  PRIVATE_CALENDAR_CLIENT_APP_ID_PATTERN,
  privateCalendarClientSecretVerifier,
} from './PrivateCalendarClientCredentials';
import {
  type PrivateClientMapExpectation,
  RadicalePrivateClientMapClient,
  RadicalePrivateClientMapError,
  type RadicalePrivateClientMapRecord,
  clientAlias,
  isExactMap,
} from './RadicalePrivateClientMapClient';

const SECRET_LENGTH_BYTES = 32;

export type PrivateCalendarClientMetadata = Readonly<{
  appId: string;
  target: PrivateCalendarClientTarget;
  state: PrivateCalendarClientRecord['state'];
  mapState: PrivateCalendarClientRecord['mapState'];
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
}>;

export type CreatedPrivateCalendarClient = Readonly<{
  client: PrivateCalendarClientMetadata;
  secret: string;
  calendarUrl: string;
}>;

type ResolvedTarget = Readonly<{
  target: PrivateCalendarClientTarget;
  canonicalPath: string;
  nativeOwner: string;
  ownerCredential: CalDavCredentialProvider;
}>;

@Injectable()
export class PrivateCalendarClientService {
  private readonly mapClient?: RadicalePrivateClientMapClient;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly appConfig: IAppConfiguration,
    private readonly authorizationFactory: MatrixCalendarAuthorizationFactory,
    private readonly credentialProviderFactory: MatrixOpenIdCalDavCredentialProviderFactory,
    private readonly roomCalendarCalDavAccess: RoomCalendarCalDavAccess,
    private readonly store: PrivateCalendarClientStore,
    fetchImpl: typeof fetch,
    private readonly randomBytesImpl: (size: number) => Buffer = randomBytes,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (appConfig.radicale_url) {
      try {
        this.mapClient = new RadicalePrivateClientMapClient(
          appConfig.radicale_url,
          fetchImpl,
        );
      } catch {
        // A malformed internal Radicale URL disables this optional capability.
      }
    }
  }

  async create(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    target: PrivateCalendarClientTarget,
  ): Promise<CreatedPrivateCalendarClient> {
    this.assertEnabled();
    return this.withTargetLock(userContext.userId, target, async () => {
      const resolved = await this.resolveTarget(
        userContext,
        openIdCredential,
        target,
      );
      const store = this.requireStore();
      const secretBytes = this.randomBytesImpl(SECRET_LENGTH_BYTES);
      if (secretBytes.byteLength !== SECRET_LENGTH_BYTES) {
        throw this.unavailable();
      }
      const secret = secretBytes.toString('base64url');
      const epochKey = this.appConfig.private_calendar_client_epoch_key;
      if (!epochKey || epochKey.byteLength !== 32) throw this.unavailable();
      const credentialEpochHash = createHash('sha256')
        .update(epochKey)
        .digest('hex');

      let appId: string | undefined;
      let pending: NewPrivateCalendarClientRecord | undefined;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const idBytes = this.randomBytesImpl(24);
        if (idBytes.byteLength !== 24) throw this.unavailable();
        appId = `mcwpc~${idBytes.toString('hex')}`;
        const createdAt = this.now();
        pending = {
          appId,
          createdBy: userContext.userId,
          target: resolved.target,
          canonicalPath: resolved.canonicalPath,
          secretVerifier: privateCalendarClientSecretVerifier(appId, secret),
          credentialEpochHash,
          createdAt,
          expiresAt: new Date(
            createdAt.getTime() +
              PRIVATE_CALENDAR_CLIENT_LIMITS.credentialLifetimeMs,
          ),
        };
        const result = await store.createPending(pending);
        if (result.kind === 'created') break;
        if (result.kind === 'capacity-reached') {
          throw new ConflictException({
            code: 'private-calendar-client-capacity-reached',
            message: 'This calendar has reached its private client limit',
          });
        }
        pending = undefined;
        appId = undefined;
      }
      if (!pending || !appId) throw this.unavailable();

      const alias = clientAlias(appId);
      const clientCredential = basicCredentialProvider(appId, secret);
      let mapMayExist = false;
      try {
        const existing = await this.requireMapClient().listForCollection(
          resolved.canonicalPath,
          resolved.ownerCredential,
        );
        if (existing.some((record) => record.PathOrToken === alias)) {
          throw new ConflictException({
            code: 'private-calendar-client-alias-conflict',
            message: 'A private calendar client alias already exists',
          });
        }

        mapMayExist = true;
        await this.requireMapClient().createForClient(
          resolved.canonicalPath,
          appId,
          resolved.ownerCredential,
        );
        const beforeAcceptance =
          await this.requireMapClient().listForCollection(
            resolved.canonicalPath,
            resolved.ownerCredential,
          );
        const created = findUniqueMap(beforeAcceptance, alias);
        if (!created || !isExpectedMap(created, resolved, appId, 'pending')) {
          throw new RadicalePrivateClientMapError('invalid-response');
        }

        await this.requireMapClient().acceptForClient(appId, clientCredential);
        const afterAcceptance = await this.requireMapClient().listForCollection(
          resolved.canonicalPath,
          resolved.ownerCredential,
        );
        const activeMap = findUniqueMap(afterAcceptance, alias);
        if (
          !activeMap ||
          !isExpectedMap(activeMap, resolved, appId, 'accepted')
        ) {
          throw new RadicalePrivateClientMapError('invalid-response');
        }

        const active = await store.activate(appId, this.now());
        if (
          !active ||
          active.state !== 'active' ||
          active.mapState !== 'present'
        ) {
          throw this.unavailable();
        }
        const origin = this.privateClientOrigin();
        return Object.freeze({
          client: metadata(active),
          secret,
          calendarUrl: new URL(alias, origin).toString(),
        });
      } catch (error) {
        await this.revokeAndCompensate(
          appId,
          resolved,
          mapMayExist,
          this.now(),
        );
        if (
          error instanceof ConflictException ||
          error instanceof ForbiddenException ||
          error instanceof BadRequestException
        ) {
          throw error;
        }
        throw error;
      }
    });
  }

  async list(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    target: PrivateCalendarClientTarget,
  ): Promise<readonly PrivateCalendarClientMetadata[]> {
    this.assertEnabled();
    const resolved = await this.resolveTarget(
      userContext,
      openIdCredential,
      target,
    );
    const records = await this.requireStore().listForTarget(
      resolved.target,
      userContext.userId,
      this.now(),
    );
    return Object.freeze(records.map(metadata));
  }

  async revoke(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    appId: string,
  ): Promise<PrivateCalendarClientMetadata> {
    this.assertEnabled();
    if (!PRIVATE_CALENDAR_CLIENT_APP_ID_PATTERN.test(appId))
      throw this.notFound();
    const store = this.requireStore();
    const existing = await store.getByAppId(appId, this.now());
    if (!existing) throw this.notFound();
    return this.withTargetLock(
      userContext.userId,
      existing.target,
      async () => {
        await this.authorizeRevocation(userContext, existing);
        const revoked = await store.revoke(appId, this.now());
        if (!revoked) throw this.notFound();

        try {
          const resolved = await this.resolveTarget(
            userContext,
            openIdCredential,
            revoked.target,
          );
          if (resolved.canonicalPath !== revoked.canonicalPath)
            return metadata(revoked);
          const records = await this.requireMapClient().listForCollection(
            revoked.canonicalPath,
            resolved.ownerCredential,
          );
          const record = findUniqueMap(records, clientAlias(appId));
          if (!record) {
            await store.markMapRemoved(appId);
          } else if (isExpectedMap(record, resolved, appId, 'cleanup')) {
            await this.requireMapClient().deleteExact(
              record,
              revoked.canonicalPath,
              appId,
              resolved.nativeOwner,
              resolved.ownerCredential,
            );
            await store.markMapRemoved(appId);
          }
        } catch {
          // Revocation is already durable; unavailable owner cleanup leaves an
          // inert alias and a tombstone for later reconciliation.
        }
        return metadata((await store.getByAppId(appId, this.now())) ?? revoked);
      },
    );
  }

  private async authorizeRevocation(
    userContext: IUserContext,
    record: PrivateCalendarClientRecord,
  ): Promise<void> {
    if (record.target.target === 'personal') {
      const user = parseMatrixUserId(userContext.userId);
      if (!user || userContext.userId !== record.createdBy)
        throw this.notFound();
      const radicaleUrl = this.appConfig.radicale_url;
      if (!radicaleUrl) throw this.unavailable();
      const calendar = validatePersonalCollectionUrl(
        parseRadicaleBaseUrl(radicaleUrl),
        new URL(record.canonicalPath, radicaleUrl).toString(),
        userContext.userId,
      );
      if (calendar.pathname !== record.canonicalPath) throw this.notFound();
      return;
    }

    if (
      !(await this.authorizationFactory.canManageCalendars(
        userContext.userId,
        record.target.roomId,
      ))
    ) {
      throw new ForbiddenException({
        code: 'private-calendar-client-management-forbidden',
        message: 'You cannot manage private clients for this room calendar',
      });
    }
  }

  private async resolveTarget(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    target: PrivateCalendarClientTarget,
  ): Promise<ResolvedTarget> {
    const radicaleUrl = this.appConfig.radicale_url;
    if (!radicaleUrl) throw this.unavailable();
    const radicaleBase = parseRadicaleBaseUrl(radicaleUrl);

    if (target.target === 'personal') {
      const user = parseMatrixUserId(userContext.userId);
      const calendar = validatePersonalCollectionUrl(
        radicaleBase,
        target.calendarId,
        userContext.userId,
      );
      if (!user) throw this.invalidTarget();
      return {
        target,
        canonicalPath: calendar.pathname,
        nativeOwner: user.localpart,
        ownerCredential: this.credentialProviderFactory.forRequest(
          userContext,
          openIdCredential,
        ),
      };
    }

    if (
      !(await this.authorizationFactory.canManageCalendars(
        userContext.userId,
        target.roomId,
      ))
    ) {
      throw new ForbiddenException({
        code: 'private-calendar-client-management-forbidden',
        message: 'You cannot manage private clients for this room calendar',
      });
    }
    let principal;
    try {
      principal = await this.roomCalendarCalDavAccess.forAuthorizedTarget(
        {
          roomId: target.roomId,
          calendarId: target.calendarId,
          principal: { kind: 'service' },
        },
        'write',
      );
    } catch {
      throw this.unavailable();
    }
    const calendar = parseCanonicalCollectionUrl(
      radicaleBase,
      principal.calendarUrl,
    );
    const owner = parseMatrixUserId(principal.userId);
    if (!owner) throw this.unavailable();
    return {
      target,
      canonicalPath: calendar.pathname,
      nativeOwner: owner.localpart,
      ownerCredential: this.credentialProviderFactory.forPrincipal(
        principal.userId,
        principal.credential,
      ),
    };
  }

  private async revokeAndCompensate(
    appId: string,
    target: ResolvedTarget,
    mapMayExist: boolean,
    now: Date,
  ): Promise<void> {
    const store = this.requireStore();
    const revoked = await store.revoke(appId, now);
    if (!revoked) return;
    if (!mapMayExist) {
      await store.markMapRemoved(appId);
      return;
    }
    try {
      const records = await this.requireMapClient().listForCollection(
        target.canonicalPath,
        target.ownerCredential,
      );
      const map = findUniqueMap(records, clientAlias(appId));
      if (!map) {
        await store.markMapRemoved(appId);
      } else if (isExpectedMap(map, target, appId, 'cleanup')) {
        await this.requireMapClient().deleteExact(
          map,
          target.canonicalPath,
          appId,
          target.nativeOwner,
          target.ownerCredential,
        );
        await store.markMapRemoved(appId);
      }
    } catch {
      // Preserve revoked state even when ambiguous native cleanup fails.
    }
  }

  private async withTargetLock<T>(
    actor: string,
    target: PrivateCalendarClientTarget,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key =
      target.target === 'room'
        ? `${actor}\0room\0${target.roomId}\0${target.calendarId}`
        : `${actor}\0personal\0${target.calendarId}`;
    const previous = this.locks.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    this.locks.set(key, current);
    if (previous) await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }

  private assertEnabled(): void {
    if (
      this.appConfig.private_calendar_clients_enabled !== true ||
      !this.appConfig.private_calendar_client_epoch_key ||
      !this.appConfig.private_calendar_client_callback_key ||
      !this.appConfig.private_calendar_client_database_url ||
      !this.appConfig.private_calendar_client_origin ||
      !this.mapClient
    ) {
      throw this.unavailable();
    }
  }

  private privateClientOrigin(): URL {
    try {
      const origin = new URL(
        this.appConfig.private_calendar_client_origin ?? '',
      );
      if (
        (origin.protocol !== 'https:' && origin.protocol !== 'http:') ||
        origin.username ||
        origin.password ||
        origin.pathname !== '/' ||
        origin.search ||
        origin.hash
      ) {
        throw new Error('invalid origin');
      }
      return new URL(`${origin.origin}/`);
    } catch {
      throw this.unavailable();
    }
  }

  private requireStore(): PrivateCalendarClientStore {
    if (!this.store.enabled) throw this.unavailable();
    return this.store;
  }

  private requireMapClient(): RadicalePrivateClientMapClient {
    if (!this.mapClient) throw this.unavailable();
    return this.mapClient;
  }

  private invalidTarget(): BadRequestException {
    return new BadRequestException({
      code: 'private-calendar-client-target-invalid',
      message: 'Private calendar client target is invalid',
    });
  }

  private notFound(): ForbiddenException {
    return new ForbiddenException({
      code: 'private-calendar-client-not-found',
      message: 'Private calendar client is unavailable',
    });
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'private-calendar-clients-disabled',
      message: 'Private calendar clients are not available',
    });
  }
}

function metadata(
  record: PrivateCalendarClientRecord,
): PrivateCalendarClientMetadata {
  return Object.freeze({
    appId: record.appId,
    target: record.target,
    state: record.state,
    mapState: record.mapState,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    ...(record.revokedAt ? { revokedAt: record.revokedAt } : {}),
  });
}

function isExpectedMap(
  record: RadicalePrivateClientMapRecord,
  target: ResolvedTarget,
  appId: string,
  expectation: PrivateClientMapExpectation,
): boolean {
  return isExactMap(
    record,
    target.canonicalPath,
    appId,
    target.nativeOwner,
    expectation,
  );
}

function findUniqueMap(
  records: readonly RadicalePrivateClientMapRecord[],
  alias: string,
): RadicalePrivateClientMapRecord | undefined {
  const found = records.filter((record) => record.PathOrToken === alias);
  return found.length === 1 ? found[0] : undefined;
}

function basicCredentialProvider(
  username: string,
  password: string,
): CalDavCredentialProvider {
  const authorization = Buffer.from(`${username}:${password}`, 'utf8').toString(
    'base64',
  );
  return {
    async getRequestHeaders() {
      return { Authorization: `Basic ${authorization}` };
    },
  };
}

function parseMatrixUserId(value: string): { localpart: string } | undefined {
  if (!isMatrixUserId(value, true)) return undefined;
  const separator = value.indexOf(':', 1);
  return { localpart: value.slice(1, separator) };
}

function parseRadicaleBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ServiceUnavailableException({
      code: 'private-calendar-clients-disabled',
      message: 'Private calendar clients are not available',
    });
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new ServiceUnavailableException({
      code: 'private-calendar-clients-disabled',
      message: 'Private calendar clients are not available',
    });
  }
  return new URL(`${url.origin}/`);
}

function validatePersonalCollectionUrl(
  radicaleBase: URL,
  calendarId: string,
  userId: string,
): URL {
  const calendar = parseCanonicalCollectionUrl(radicaleBase, calendarId);
  const owner = parseMatrixUserId(userId);
  const segments = decodeSafePathSegments(calendar.pathname);
  if (!owner || segments.length !== 2 || segments[0] !== owner.localpart) {
    throw new BadRequestException({
      code: 'private-calendar-client-target-invalid',
      message: 'Private calendar client target is invalid',
    });
  }
  return calendar;
}

function parseCanonicalCollectionUrl(radicaleBase: URL, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException({
      code: 'private-calendar-client-target-invalid',
      message: 'Private calendar client target is invalid',
    });
  }
  const segments = decodeSafePathSegments(url.pathname);
  if (
    url.href !== value ||
    url.origin !== radicaleBase.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('/') ||
    segments.length !== 2
  ) {
    throw new BadRequestException({
      code: 'private-calendar-client-target-invalid',
      message: 'Private calendar client target is invalid',
    });
  }
  return url;
}

function decodeSafePathSegments(pathname: string): string[] {
  if (
    !pathname.startsWith('/') ||
    pathname.includes('\\') ||
    /%(?![0-9a-f]{2})|%(?:2f|5c|00)/iu.test(pathname)
  ) {
    throw new BadRequestException({
      code: 'private-calendar-client-target-invalid',
      message: 'Private calendar client target is invalid',
    });
  }
  const parts = pathname.split('/');
  if (parts[0] !== '' || parts.at(-1) !== '') {
    throw new BadRequestException({
      code: 'private-calendar-client-target-invalid',
      message: 'Private calendar client target is invalid',
    });
  }
  const result = parts.slice(1, -1).map((part) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      throw new BadRequestException({
        code: 'private-calendar-client-target-invalid',
        message: 'Private calendar client target is invalid',
      });
    }
    if (
      !decoded ||
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      decoded.includes('%') ||
      // Intentional validation of raw control characters in path segments.
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f]/u.test(decoded)
    ) {
      throw new BadRequestException({
        code: 'private-calendar-client-target-invalid',
        message: 'Private calendar client target is invalid',
      });
    }
    return decoded;
  });
  if (result.some((part) => !part)) {
    throw new BadRequestException({
      code: 'private-calendar-client-target-invalid',
      message: 'Private calendar client target is invalid',
    });
  }
  return result;
}
