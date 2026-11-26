/* Modified for Matrix Calendar Widget fork, 2026. */
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

import { readFileSync } from 'node:fs';
import type {
  BlockedRequestClass,
  BlockedRequestDiagnostic,
  BlockedRequestEvidence,
  BlockedRequestResourceType,
  BrowserActor,
  Phase,
} from './elementAcceptanceSupportTypes';
import type { Fixture } from './elementAcceptanceTypes';

export function createFixtureAcceptanceHelpers(
  record: (
    phase: Phase,
    status: 'started' | 'passed' | 'failed',
    httpStatus?: number,
    count?: number,
    extra?: {
      blockedRequestDiagnostics?: BlockedRequestDiagnostic[];
      blockedRequestDiagnosticOverflow?: boolean;
    },
  ) => void,
) {
  const BLOCKED_REQUEST_RESOURCE_TYPES = new Set<BlockedRequestResourceType>([
    'document',
    'stylesheet',
    'image',
    'media',
    'font',
    'script',
    'texttrack',
    'xhr',
    'fetch',
    'eventsource',
    'websocket',
    'manifest',
    'other',
  ]);

  const MAX_BLOCKED_REQUEST_DIAGNOSTIC_BUCKETS = 32;

  function readFixture(): Fixture {
    const path = process.env.ELEMENT_ACCEPTANCE_USERS_FILE;
    if (!path) throw new Error('Element acceptance fixture unavailable');
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
    } catch {
      throw new Error('Element acceptance fixture unavailable');
    }
  }

  function recordBlockedRequestFailure(
    blockedRequestCount: number,
    evidence: BlockedRequestEvidence,
  ): boolean {
    if (blockedRequestCount === 0) return false;
    record('browser-egress', 'failed', undefined, blockedRequestCount, {
      blockedRequestDiagnostics: Array.from(evidence.diagnostics.values()),
      blockedRequestDiagnosticOverflow: evidence.overflow,
    });
    return true;
  }

  function safeBlockedRequestResourceType(
    resourceType: string,
  ): BlockedRequestResourceType {
    return BLOCKED_REQUEST_RESOURCE_TYPES.has(
      resourceType as BlockedRequestResourceType,
    )
      ? (resourceType as BlockedRequestResourceType)
      : 'other';
  }

  function classifyBlockedRequest(
    url: URL,
    fixtureHosts: ReadonlySet<string>,
  ): BlockedRequestClass {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'non-http-scheme';
    }

    const hostname = url.hostname.toLowerCase();
    if (fixtureHosts.has(hostname)) {
      if (url.pathname === '/.well-known/matrix/client') {
        return 'matrix-client-well-known-discovery';
      }
      if (url.pathname === '/.well-known/matrix/server') {
        return 'matrix-server-well-known-discovery';
      }
      return 'fixture-host-origin-mismatch';
    }

    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      /^127(?:\.\d{1,3}){3}$/u.test(hostname)
    ) {
      return 'unapproved-loopback-origin';
    }

    return 'external-http-origin';
  }

  function recordBlockedRequest(
    evidence: BlockedRequestEvidence,
    actor: BrowserActor,
    harnessPhase: Phase,
    requestClass: BlockedRequestClass,
    resourceType: BlockedRequestResourceType,
  ) {
    const key = JSON.stringify([
      actor,
      harnessPhase,
      requestClass,
      resourceType,
    ]);
    const existing = evidence.diagnostics.get(key);
    if (existing) {
      existing.count = Math.min(existing.count + 1, 2);
      return;
    }
    if (evidence.diagnostics.size >= MAX_BLOCKED_REQUEST_DIAGNOSTIC_BUCKETS) {
      evidence.overflow = true;
      return;
    }

    evidence.diagnostics.set(key, {
      actor,
      harnessPhase,
      requestClass,
      resourceType,
      count: 1,
    });
  }

  return {
    readFixture,
    recordBlockedRequestFailure,
    safeBlockedRequestResourceType,
    classifyBlockedRequest,
    recordBlockedRequest,
  };
}
