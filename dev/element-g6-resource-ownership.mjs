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

const STRONG_ETAG = /^"[\x21\x23-\x7e]{1,200}"$/u;

export function createG6ResourceOwnership(name) {
  return {
    name,
    state: 'not-attempted',
    etag: undefined,
    confirmedCreated: false,
  };
}

export function beginG6ResourceCreate(resource) {
  if (resource.state !== 'not-attempted') return false;
  resource.state = 'creating';
  return true;
}

export function recordG6ResourceCreate(resource, status, etag) {
  if (resource.state !== 'creating') return false;

  if (Number.isInteger(status) && status >= 200 && status < 300) {
    if (typeof etag === 'string' && STRONG_ETAG.test(etag)) {
      resource.state = 'created';
      resource.etag = etag;
      resource.confirmedCreated = true;
      return true;
    }
    resource.state = 'create-unresolved';
    return false;
  }

  if (status === 409 || status === 412) {
    resource.state = 'conflict';
    return false;
  }

  if (Number.isInteger(status) && status >= 400 && status < 500) {
    resource.state = 'rejected';
    return false;
  }

  resource.state = 'create-unresolved';
  return false;
}

export function recordG6ResourceUpdate(
  resource,
  status,
  etag,
  identityMatches,
) {
  if (resource.state !== 'created') return false;

  if (
    Number.isInteger(status) &&
    status >= 200 &&
    status < 300 &&
    identityMatches === true &&
    typeof etag === 'string' &&
    STRONG_ETAG.test(etag) &&
    etag !== resource.etag
  ) {
    resource.etag = etag;
    return true;
  }

  resource.state = 'cleanup-unresolved';
  resource.etag = undefined;
  return false;
}

export function g6ResourceCleanupRequest(resource) {
  if (resource.state === 'created' && typeof resource.etag === 'string') {
    return { method: 'DELETE', ifMatch: resource.etag };
  }
  return { method: 'skip' };
}

export function recordG6ResourceCleanup(resource, status) {
  if (resource.state !== 'created') return false;

  if (Number.isInteger(status) && status >= 200 && status < 300) {
    resource.state = 'deleted';
    resource.etag = undefined;
    return true;
  }
  if (status === 404) {
    resource.state = 'absent';
    resource.etag = undefined;
    return true;
  }

  resource.state = 'cleanup-unresolved';
  resource.etag = undefined;
  return false;
}

export function summarizeG6ResourceOwnership(resources) {
  const counts = {
    plannedCount: resources.length,
    confirmedCreatedCount: resources.filter((item) => item.confirmedCreated)
      .length,
    conflictCount: 0,
    notCreatedCount: 0,
    createUnresolvedCount: 0,
    deletedCount: 0,
    alreadyAbsentCount: 0,
    cleanupUnresolvedCount: 0,
  };

  for (const resource of resources) {
    switch (resource.state) {
      case 'not-attempted':
      case 'rejected':
        counts.notCreatedCount += 1;
        break;
      case 'conflict':
        counts.conflictCount += 1;
        break;
      case 'creating':
      case 'create-unresolved':
        counts.createUnresolvedCount += 1;
        break;
      case 'created':
      case 'cleanup-unresolved':
        counts.cleanupUnresolvedCount += 1;
        break;
      case 'deleted':
        counts.deletedCount += 1;
        break;
      case 'absent':
        counts.alreadyAbsentCount += 1;
        break;
      default:
        counts.createUnresolvedCount += 1;
        break;
    }
  }

  const count = counts.deletedCount + counts.alreadyAbsentCount;
  return {
    ...counts,
    count,
    allOwnedResourcesRemoved:
      counts.createUnresolvedCount === 0 && counts.cleanupUnresolvedCount === 0,
  };
}
