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
  ServiceUnavailableException,
} from '@nestjs/common';
import { IAppConfiguration } from '../../IAppConfiguration';
import { MatrixOpenIdCalDavCredentialError } from '../../caldav/MatrixOpenIdCalDavCredentialProvider';
import { MatrixOpenIdCalDavCredentialProviderFactory } from '../../caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import { IMatrixOpenIdCredential } from '../../model/IMatrixOpenIdCredential';
import { IUserContext } from '../../model/IUserContext';
import { MatrixCalendarAuthorizationFactory } from '../MatrixCalendarAuthorization';
import { isCanonicalMatrixRoomId } from '../RoomCalendarBindingResolver';
import {
  RoomCalendarCalDavAccess,
  RoomCalendarTarget,
} from '../RoomCalendarCalDavAccess';
import {
  assertVeventOnlyCalendar,
  PublicCalendarFeedComponentError,
} from './PublicCalendarFeedIcs';
import {
  hashPublicCalendarFeedScope,
  publicCalendarFeedUrl,
  signPublicCalendarFeedEnvelope,
  verifyPublicCalendarFeedEnvelope,
} from './PublicCalendarFeedToken';
import {
  NativeCalendarFeed,
  RadicaleNativeTokenShare,
  RadicalePublicFeedClient,
  RadicalePublicFeedError,
} from './RadicalePublicFeedClient';

const SHARE_MARKER_PREFIX = 'Matrix Calendar Widget public feed:';
const CALENDAR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export type PublicCalendarFeedTarget =
  | Readonly<{ target: 'personal'; calendarId: string }>
  | Readonly<{
      target: 'room';
      roomId: string;
      calendarId: string;
    }>;

export type PublicCalendarFeedPublication = Readonly<{
  enabled: boolean;
  published: boolean;
  url?: string;
}>;

type ResolvedTarget = {
  canonicalPath: string;
  scopeHash: string;
  marker: string;
  credentials: ReturnType<
    MatrixOpenIdCalDavCredentialProviderFactory['forRequest']
  >;
};

/**
 * Publishes an explicit, read-only native Radicale token for one authorized
 * calendar. Radicale's share database remains the publication source of truth.
 */
export class PublicCalendarFeedService {
  private readonly client?: RadicalePublicFeedClient;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly appConfig: IAppConfiguration,
    private readonly authorizationFactory: MatrixCalendarAuthorizationFactory,
    private readonly credentialProviderFactory: MatrixOpenIdCalDavCredentialProviderFactory,
    private readonly roomCalendarCalDavAccess: RoomCalendarCalDavAccess,
    fetchImpl: typeof fetch,
  ) {
    if (appConfig.radicale_url) {
      try {
        this.client = new RadicalePublicFeedClient(
          appConfig.radicale_url,
          fetchImpl,
        );
      } catch {
        // A malformed internal URL disables publication without logging it.
      }
    }
  }

  async getPublication(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    target: PublicCalendarFeedTarget,
  ): Promise<PublicCalendarFeedPublication> {
    const enabled = this.isEnabled();
    if (!this.appConfig.public_calendar_feed_signing_key || !this.client) {
      return { enabled: false, published: false };
    }

    return this.withTargetLock(target, async () => {
      const resolved = await this.resolveTarget(
        userContext,
        openIdCredential,
        target,
      );
      const shares = await this.listShares(resolved);
      const share = this.selectPublishedShare(shares, resolved);
      return share
        ? {
            enabled,
            published: true,
            ...(this.appConfig.public_calendar_feed_origin
              ? { url: this.urlForShare(share, resolved) }
              : {}),
          }
        : { enabled, published: false };
    });
  }

  async publish(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    target: PublicCalendarFeedTarget,
    consentConfirmed: boolean,
  ): Promise<PublicCalendarFeedPublication> {
    if (!consentConfirmed) {
      throw new BadRequestException({
        code: 'public-calendar-feed-consent-required',
        message: 'Confirm that anyone with the link can read this calendar',
      });
    }
    const client = this.client;
    if (!this.isEnabled() || !client) {
      throw new ServiceUnavailableException({
        code: 'public-calendar-feeds-disabled',
        message: 'Public calendar feeds are not enabled',
      });
    }

    return this.withTargetLock(target, async () => {
      const resolved = await this.resolveTarget(
        userContext,
        openIdCredential,
        target,
      );
      const shares = await this.listShares(resolved);
      const marked = this.markedShares(shares, resolved);
      const published = this.selectPublishedShare(marked, resolved);

      if (published) {
        await this.deleteMarkedShares(
          marked.filter((share) => share.PathOrToken !== published.PathOrToken),
          resolved,
        );
        await this.readAndValidateNativeFeed(published.PathOrToken);
        return {
          enabled: true,
          published: true,
          url: this.urlForShare(published, resolved),
        };
      }

      // Remove only tokens bearing this exact app/scope marker. Other native
      // shares belonging to the owner are never changed by this feature.
      await this.deleteMarkedShares(marked, resolved);

      let newTokenPath: string | undefined;
      try {
        newTokenPath = await client.createReadOnlyTokenShare(
          resolved.canonicalPath,
          resolved.marker,
          resolved.credentials,
        );
        const afterCreate = await this.listShares(resolved);
        const createdShare = afterCreate.find(
          (share) => share.PathOrToken === newTokenPath,
        );
        if (!createdShare || !this.isPublishedShare(createdShare, resolved)) {
          throw new RadicalePublicFeedError('invalid-response');
        }

        await this.readAndValidateNativeFeed(newTokenPath);
        const postCreateTarget = await this.resolveTarget(
          userContext,
          openIdCredential,
          target,
        );
        if (
          postCreateTarget.canonicalPath !== resolved.canonicalPath ||
          postCreateTarget.scopeHash !== resolved.scopeHash
        ) {
          throw new ForbiddenException({
            code: 'public-calendar-feed-target-changed',
            message: 'Calendar publication target changed during the request',
          });
        }

        return {
          enabled: true,
          published: true,
          url: this.urlForShare(createdShare, resolved),
        };
      } catch (error) {
        if (newTokenPath) {
          try {
            await client.deleteTokenShare(newTokenPath, resolved.credentials);
          } catch {
            // Preserve the original error; cleanup is best effort and bounded.
          }
        } else {
          // The native create request may commit before its response is lost or
          // malformed. The target lock and deterministic marker let us find
          // only this feature's newly-created share without risking unrelated
          // owner shares.
          try {
            const afterFailedCreate = await this.listShares(resolved);
            await this.deleteMarkedShares(
              this.markedShares(afterFailedCreate, resolved),
              resolved,
            );
          } catch {
            // Preserve the original error; reconciliation is best effort.
          }
        }
        throw mapPublicFeedError(error);
      }
    });
  }

  async unpublish(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    target: PublicCalendarFeedTarget,
  ): Promise<PublicCalendarFeedPublication> {
    if (!this.appConfig.public_calendar_feed_signing_key || !this.client) {
      throw new ServiceUnavailableException({
        code: 'public-calendar-feeds-disabled',
        message: 'Public calendar feed signing is not configured',
      });
    }

    return this.withTargetLock(target, async () => {
      const resolved = await this.resolveTarget(
        userContext,
        openIdCredential,
        target,
      );
      const shares = await this.listShares(resolved);
      await this.deleteMarkedShares(
        this.markedShares(shares, resolved),
        resolved,
      );
      return {
        enabled: this.isEnabled(),
        published: false,
      };
    });
  }

  async readPublicFeed(envelope: string): Promise<NativeCalendarFeed> {
    if (!this.isEnabled() || !this.client) {
      throw new RadicalePublicFeedError('not-found');
    }
    const verified = verifyPublicCalendarFeedEnvelope(
      envelope,
      this.appConfig.public_calendar_feed_signing_key,
    );
    if (!verified) throw new RadicalePublicFeedError('not-found');

    const feed = await this.client.getNativeCalendarFeed(verified.tokenPath);
    assertVeventOnlyCalendar(feed.bytes);
    return feed;
  }

  private async resolveTarget(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    target: PublicCalendarFeedTarget,
  ): Promise<ResolvedTarget> {
    const signingKey = this.appConfig.public_calendar_feed_signing_key;
    if (!signingKey || !this.appConfig.radicale_url || !this.client) {
      throw new ServiceUnavailableException({
        code: 'public-calendar-feeds-disabled',
        message: 'Public calendar feeds are not enabled',
      });
    }
    const base = parseRootRadicaleUrl(this.appConfig.radicale_url);

    let collectionUrl: string;
    let credentials: ResolvedTarget['credentials'];
    let scope: string;

    if (target.target === 'room') {
      const authorization = this.authorizationFactory.forRoom(
        userContext.userId,
        target.roomId,
      );
      if (
        !(await authorization.isAllowed({
          action: 'manage-calendar',
          calendarId: target.calendarId,
        }))
      ) {
        throw new ForbiddenException({
          code: 'public-calendar-feed-management-forbidden',
          message: 'You cannot manage this room calendar',
        });
      }
      const roomTarget: RoomCalendarTarget = {
        roomId: target.roomId,
        calendarId: target.calendarId,
        principal: { kind: 'service' },
      };
      const principal = await this.roomCalendarCalDavAccess.forAuthorizedTarget(
        roomTarget,
        'read',
      );
      collectionUrl = principal.calendarUrl;
      credentials = this.credentialProviderFactory.forPrincipal(
        principal.userId,
        principal.credential,
      );
      scope = `room\0${target.roomId}\0${target.calendarId}`;
    } else {
      collectionUrl = validatePersonalCollectionUrl(
        base,
        target.calendarId,
        userContext.userId,
      );
      credentials = this.credentialProviderFactory.forRequest(
        userContext,
        openIdCredential,
      );
      scope = `personal\0${userContext.userId}\0${new URL(collectionUrl).pathname}`;
    }

    const path = new URL(collectionUrl);
    if (
      path.origin !== base.origin ||
      path.search ||
      path.hash ||
      !path.pathname.endsWith('/')
    ) {
      throw new BadRequestException({
        code: 'public-calendar-feed-target-invalid',
        message: 'Calendar publication target is invalid',
      });
    }
    const canonicalPath = path.pathname;
    const scopeHash = hashPublicCalendarFeedScope(
      signingKey,
      `${scope}\0${canonicalPath}`,
    );
    return {
      canonicalPath,
      scopeHash,
      marker: `${SHARE_MARKER_PREFIX}${scopeHash}`,
      credentials,
    };
  }

  private async listShares(
    target: ResolvedTarget,
  ): Promise<readonly RadicaleNativeTokenShare[]> {
    try {
      return await this.client!.listTokenShares(
        target.canonicalPath,
        target.credentials,
      );
    } catch (error) {
      throw mapPublicFeedError(error);
    }
  }

  private markedShares(
    shares: readonly RadicaleNativeTokenShare[],
    target: ResolvedTarget,
  ): RadicaleNativeTokenShare[] {
    return shares.filter(
      (share) =>
        share.PathMapped === target.canonicalPath &&
        share.Properties?.['D:displayname'] === target.marker,
    );
  }

  private selectPublishedShare(
    shares: readonly RadicaleNativeTokenShare[],
    target: ResolvedTarget,
  ): RadicaleNativeTokenShare | undefined {
    return this.markedShares(shares, target)
      .filter((share) => this.isPublishedShare(share, target))
      .sort((left, right) =>
        left.PathOrToken.localeCompare(right.PathOrToken),
      )[0];
  }

  private isPublishedShare(
    share: RadicaleNativeTokenShare,
    target: ResolvedTarget,
  ): boolean {
    return (
      share.PathMapped === target.canonicalPath &&
      share.Permissions === 'r' &&
      share.Conversion === 'none' &&
      share.EnabledByOwner &&
      share.Properties?.['D:displayname'] === target.marker
    );
  }

  private async deleteMarkedShares(
    shares: readonly RadicaleNativeTokenShare[],
    target: ResolvedTarget,
  ): Promise<void> {
    for (const share of [...shares].sort((left, right) =>
      left.PathOrToken.localeCompare(right.PathOrToken),
    )) {
      try {
        await this.client!.deleteTokenShare(
          share.PathOrToken,
          target.credentials,
        );
      } catch (error) {
        throw mapPublicFeedError(error);
      }
    }
  }

  private async readAndValidateNativeFeed(tokenPath: string): Promise<void> {
    try {
      const feed = await this.client!.getNativeCalendarFeed(tokenPath);
      assertVeventOnlyCalendar(feed.bytes);
    } catch (error) {
      throw mapPublicFeedError(error);
    }
  }

  private urlForShare(
    share: RadicaleNativeTokenShare,
    target: ResolvedTarget,
  ): string {
    return publicCalendarFeedUrl(
      this.appConfig.public_calendar_feed_origin!,
      signPublicCalendarFeedEnvelope(
        share.PathOrToken,
        target.scopeHash,
        this.appConfig.public_calendar_feed_signing_key!,
      ),
    );
  }

  private isEnabled(): boolean {
    return Boolean(
      this.appConfig.public_calendar_feed_enabled &&
      this.appConfig.public_calendar_feed_origin &&
      this.appConfig.public_calendar_feed_signing_key,
    );
  }

  private async withTargetLock<T>(
    target: PublicCalendarFeedTarget,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key =
      target.target === 'room'
        ? `room\0${target.roomId}\0${target.calendarId}`
        : `personal\0${target.calendarId}`;
    const previous = this.locks.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, current);
    if (previous) await previous;

    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
}

export function parsePublicCalendarFeedTarget(
  target: unknown,
  calendarId: unknown,
  roomId?: unknown,
): PublicCalendarFeedTarget {
  if (
    typeof calendarId !== 'string' ||
    calendarId.length === 0 ||
    calendarId.length > 4096
  ) {
    throw invalidTarget();
  }

  if (target === 'personal' || target === undefined) {
    if (roomId !== undefined && roomId !== '') throw invalidTarget();
    return { target: 'personal', calendarId };
  }

  if (
    target === 'room' &&
    typeof roomId === 'string' &&
    isCanonicalMatrixRoomId(roomId) &&
    CALENDAR_ID_PATTERN.test(calendarId)
  ) {
    return { target: 'room', roomId, calendarId };
  }

  throw invalidTarget();
}

export function parsePublicCalendarFeedTargetBody(
  value: unknown,
  requireConfirmation = false,
): PublicCalendarFeedTarget {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw invalidTarget();
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    !keys.includes('target') ||
    !keys.includes('calendarId') ||
    keys.some(
      (key) =>
        !['target', 'calendarId', 'roomId', 'confirmed'].includes(String(key)),
    ) ||
    (requireConfirmation && record.confirmed !== true) ||
    (!requireConfirmation && record.confirmed !== undefined)
  ) {
    throw invalidTarget();
  }
  return parsePublicCalendarFeedTarget(
    record.target,
    record.calendarId,
    record.roomId,
  );
}

function validatePersonalCollectionUrl(
  radicaleBase: URL,
  calendarId: string,
  userId: string,
): string {
  let collection: URL;
  let localpart: string;
  try {
    localpart = matrixUserLocalpart(userId);
    collection = new URL(calendarId);
  } catch {
    throw invalidTarget();
  }

  const segments = decodeSafePathSegments(collection.pathname);
  if (
    collection.href !== calendarId ||
    collection.origin !== radicaleBase.origin ||
    collection.username ||
    collection.password ||
    collection.search ||
    collection.hash ||
    !collection.pathname.endsWith('/') ||
    segments.length !== 2 ||
    segments[0] !== localpart ||
    !segments[1]
  ) {
    throw invalidTarget();
  }
  return collection.toString();
}

function matrixUserLocalpart(userId: string): string {
  const separator = userId.indexOf(':');
  if (
    !userId.startsWith('@') ||
    separator <= 1 ||
    separator === userId.length - 1
  ) {
    throw new Error('Invalid Matrix user ID');
  }
  return userId.slice(1, separator);
}

function decodeSafePathSegments(pathname: string): string[] {
  if (
    !pathname.startsWith('/') ||
    pathname.includes('\\') ||
    /%(?![0-9A-Fa-f]{2})/u.test(pathname) ||
    /%2f|%5c|%00/iu.test(pathname)
  ) {
    throw invalidTarget();
  }
  const rawSegments = pathname.split('/');
  if (rawSegments[0] !== '' || rawSegments.at(-1) !== '') {
    throw invalidTarget();
  }
  const segments = rawSegments.slice(1, -1).map((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw invalidTarget();
    }
    if (
      !decoded ||
      decoded === '.' ||
      decoded === '..' ||
      containsForbiddenPathCharacter(decoded)
    ) {
      throw invalidTarget();
    }
    return decoded;
  });
  if (segments.length < 1) throw invalidTarget();
  return segments;
}

function containsForbiddenPathCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      character === '/' ||
      character === '\\' ||
      (codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f))
    ) {
      return true;
    }
  }
  return false;
}

function parseRootRadicaleUrl(value: string): URL {
  try {
    const base = new URL(value);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== '/'
    ) {
      throw new Error();
    }
    return base;
  } catch {
    throw new ServiceUnavailableException({
      code: 'public-calendar-feed-upstream-unavailable',
      message: 'Public calendar feed service is unavailable',
    });
  }
}

function invalidTarget(): BadRequestException {
  return new BadRequestException({
    code: 'public-calendar-feed-target-invalid',
    message: 'Calendar publication target is invalid',
  });
}

function mapPublicFeedError(error: unknown): Error {
  if (error instanceof PublicCalendarFeedComponentError) {
    return new ConflictException({
      code: 'public-calendar-feed-components-unsupported',
      message: 'Only VEVENT-only calendars can be published as public feeds',
    });
  }
  if (error instanceof MatrixOpenIdCalDavCredentialError) {
    return new ForbiddenException({
      code: 'public-calendar-feed-owner-authorization-required',
      message: 'Calendar owner authorization is required',
    });
  }
  if (error instanceof RadicalePublicFeedError) {
    if (error.code === 'unauthorized') {
      return new ForbiddenException({
        code: 'public-calendar-feed-owner-authorization-required',
        message: 'Calendar owner authorization is required',
      });
    }
    return new ServiceUnavailableException({
      code: 'public-calendar-feed-upstream-unavailable',
      message: 'Public calendar feed service is unavailable',
    });
  }
  if (
    error instanceof ConflictException ||
    error instanceof ForbiddenException ||
    error instanceof BadRequestException ||
    error instanceof ServiceUnavailableException
  ) {
    return error;
  }
  return new ServiceUnavailableException({
    code: 'public-calendar-feed-upstream-unavailable',
    message: 'Public calendar feed service is unavailable',
  });
}
