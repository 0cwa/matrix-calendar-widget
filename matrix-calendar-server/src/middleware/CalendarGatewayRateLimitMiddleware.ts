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

import { NextFunction, Request, Response } from 'express';

export const CALENDAR_GATEWAY_MAX_RATE_LIMIT_KEYS = 10_000;
const CLEANUP_INTERVAL_MAX_MS = 10_000;

interface SourceWindow {
  count: number;
  resetAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
  denial?:
    | { reason: 'source-window'; count: number; activeKeyCount: number }
    | { reason: 'source-key-cap'; activeKeyCount: number };
}

export interface RateLimitDiagnostic {
  event: 'calendar_gateway_rate_limit_denied';
  reason: 'source-window' | 'source-key-cap';
  count?: number;
  activeKeyCount: number;
  limit: number;
  windowMs: number;
  retryAfterSeconds: number;
  method:
    | 'GET'
    | 'POST'
    | 'PUT'
    | 'PATCH'
    | 'DELETE'
    | 'OPTIONS'
    | 'HEAD'
    | 'OTHER';
  routeClass: 'calendar-api';
}

/**
 * A process-local fixed-window counter with an explicit source-key cap.
 * Cleanup scans at most `maxSources` entries and runs no more than once per
 * min(window, 10 seconds), rather than doing a full-map scan per request.
 */
export class BoundedFixedWindowSourceRateLimiter {
  private readonly sources = new Map<string, SourceWindow>();
  private readonly cleanupIntervalMs: number;
  private nextCleanupAt = 0;

  constructor(
    readonly requestsPerWindow: number,
    readonly windowMs: number,
    readonly maxSources: number,
  ) {
    if (!Number.isSafeInteger(requestsPerWindow) || requestsPerWindow < 1) {
      throw new Error('Rate-limit request count must be a positive integer');
    }
    if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
      throw new Error('Rate-limit window must be a positive integer');
    }
    if (
      !Number.isSafeInteger(maxSources) ||
      maxSources < 1 ||
      maxSources > CALENDAR_GATEWAY_MAX_RATE_LIMIT_KEYS
    ) {
      throw new Error('Rate-limit source cap is outside the supported range');
    }

    this.cleanupIntervalMs = Math.min(windowMs, CLEANUP_INTERVAL_MAX_MS);
  }

  consume(sourceKey: string, now = Date.now()): RateLimitDecision {
    this.cleanupExpiredSources(now);

    const key = sourceKey || 'unknown';
    const existing = this.sources.get(key);
    if (existing && existing.resetAt > now) {
      if (existing.count >= this.requestsPerWindow) {
        return {
          allowed: false,
          retryAfterSeconds: this.retryAfterSeconds(existing.resetAt - now),
          denial: {
            reason: 'source-window',
            count: existing.count,
            activeKeyCount: this.sources.size,
          },
        };
      }

      existing.count += 1;
      return { allowed: true };
    }

    if (existing) {
      this.sources.delete(key);
    }

    if (this.sources.size >= this.maxSources) {
      // We intentionally do not scan the map for its earliest expiry here.
      // This response is conservative and keeps attacker-controlled key churn
      // from turning the saturation path into a repeated full-map scan.
      return {
        allowed: false,
        retryAfterSeconds: this.retryAfterSeconds(this.windowMs),
        denial: {
          reason: 'source-key-cap',
          activeKeyCount: this.sources.size,
        },
      };
    }

    this.sources.set(key, { count: 1, resetAt: now + this.windowMs });
    return { allowed: true };
  }

  private cleanupExpiredSources(now: number): void {
    if (now < this.nextCleanupAt) {
      return;
    }

    for (const [key, sourceWindow] of this.sources) {
      if (sourceWindow.resetAt <= now) {
        this.sources.delete(key);
      }
    }

    this.nextCleanupAt = now + this.cleanupIntervalMs;
  }

  private retryAfterSeconds(milliseconds: number): number {
    return Math.max(1, Math.ceil(milliseconds / 1000));
  }
}

export function isCalendarGatewayPath(path: string): boolean {
  return /^\/v1\/calendar(?:\/|$)/i.test(path);
}

/**
 * Reject excessive calendar API traffic before MatrixAuthMiddleware performs
 * OpenID verification against the configured homeserver.
 */
export class CalendarGatewayRateLimitMiddleware {
  constructor(
    private readonly limiter: BoundedFixedWindowSourceRateLimiter,
    private readonly diagnostic?: (event: RateLimitDiagnostic) => void,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const path = request.path ?? request.url?.split('?')[0] ?? '';
    if (!isCalendarGatewayPath(path)) {
      next();
      return;
    }

    // Do not derive this key from X-Forwarded-For or another caller-controlled
    // header. A reverse proxy therefore shares one source quota unless an
    // upstream limiter separates callers.
    const sourceKey = request.socket?.remoteAddress || 'unknown';
    const decision = this.limiter.consume(sourceKey);
    if (decision.allowed) {
      next();
      return;
    }

    response.setHeader('Retry-After', String(decision.retryAfterSeconds));
    if (decision.denial && this.diagnostic) {
      const method = request.method?.toUpperCase();
      this.diagnostic({
        event: 'calendar_gateway_rate_limit_denied',
        ...decision.denial,
        limit:
          decision.denial.reason === 'source-key-cap'
            ? this.limiter.maxSources
            : this.limiter.requestsPerWindow,
        windowMs: this.limiter.windowMs,
        retryAfterSeconds: decision.retryAfterSeconds ?? 1,
        method:
          method === 'GET' ||
          method === 'POST' ||
          method === 'PUT' ||
          method === 'PATCH' ||
          method === 'DELETE' ||
          method === 'OPTIONS' ||
          method === 'HEAD'
            ? method
            : 'OTHER',
        routeClass: 'calendar-api',
      });
    }
    response.status(429).json({
      statusCode: 429,
      message: 'Too many requests',
    });
  }
}
