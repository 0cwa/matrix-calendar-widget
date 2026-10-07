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
const G6_EXTERNAL_RADICALE_ORIGIN = 'http://127.0.0.1:5233';
const G6_GATEWAY_RADICALE_ORIGIN = 'http://restore-radicale:5232';
const G6_COLLECTION_PATH = '/_matrix_calendar_service/element-acceptance/';
const G6_RESOURCE_NAME = /^g6-[0-9a-f-]{36}\.ics$/u;

function parseOwnedG6ResourceHref(href, expectedOrigin) {
  if (typeof href !== 'string') return undefined;
  let url;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (
    url.origin !== expectedOrigin ||
    url.protocol !== 'http:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.href !== href ||
    !url.pathname.startsWith(G6_COLLECTION_PATH)
  ) {
    return undefined;
  }
  const resourceName = url.pathname.slice(G6_COLLECTION_PATH.length);
  if (
    !G6_RESOURCE_NAME.test(resourceName) ||
    url.pathname !== `${G6_COLLECTION_PATH}${resourceName}`
  ) {
    return undefined;
  }
  return url;
}

// The fixture reaches the restored volume externally on 5233, while the
// gateway reports the same canonical resource from its Compose origin on 5232.
export function g6GatewayResourceIdentityMatches(
  gatewayEventHref,
  externallyOwnedResourceHref,
) {
  const external = parseOwnedG6ResourceHref(
    externallyOwnedResourceHref,
    G6_EXTERNAL_RADICALE_ORIGIN,
  );
  const gateway = parseOwnedG6ResourceHref(
    gatewayEventHref,
    G6_GATEWAY_RADICALE_ORIGIN,
  );
  return external !== undefined && gateway?.pathname === external.pathname;
}

export function isStrongG6ResourceEtag(etag) {
  return typeof etag === 'string' && STRONG_ETAG.test(etag);
}

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
    if (isStrongG6ResourceEtag(etag)) {
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
    isStrongG6ResourceEtag(etag) &&
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
