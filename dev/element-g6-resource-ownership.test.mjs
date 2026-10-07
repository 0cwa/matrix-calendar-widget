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

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginG6ResourceCreate,
  createG6ResourceOwnership,
  g6EventSummaryMatches,
  g6GatewayResourceIdentityMatches,
  g6ResourceCleanupRequest,
  isStrongG6ResourceEtag,
  recordG6ResourceCleanup,
  recordG6ResourceCreate,
  recordG6ResourceUpdate,
  summarizeG6ResourceOwnership,
} from './element-g6-resource-ownership.mjs';

test('compares one bounded canonical VEVENT summary without returning content', () => {
  const bytes = Buffer.from(
    'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:G6 neighbor edited abc\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
  );
  assert.equal(g6EventSummaryMatches(bytes, 'G6 neighbor edited abc'), true);
  assert.equal(g6EventSummaryMatches(bytes, 'G6 neighbor edited other'), false);
  assert.equal(
    g6EventSummaryMatches(
      Buffer.from(
        'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:G6 neighbor\r\n edited abc\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
      ),
      'G6 neighboredited abc',
    ),
    true,
  );
});

test('canonical summary comparison is inconclusive for invalid or ambiguous data', () => {
  assert.equal(g6EventSummaryMatches(Buffer.from([0xff]), 'title'), undefined);
  assert.equal(
    g6EventSummaryMatches(Buffer.from('BEGIN:VCALENDAR\r\n'), 'title'),
    undefined,
  );
  assert.equal(
    g6EventSummaryMatches(Buffer.from('SUMMARY:a\r\nSUMMARY:b\r\n'), 'a'),
    undefined,
  );
  assert.equal(g6EventSummaryMatches(Buffer.alloc(16_385), 'title'), undefined);
});

test('matches the same owned G6 resource across the two fixture Radicale origins', () => {
  const external =
    'http://127.0.0.1:5233/_matrix_calendar_service/element-acceptance/g6-01234567-89ab-cdef-0123-456789abcdef.ics';
  const internal = external.replace(
    'http://127.0.0.1:5233',
    'http://restore-radicale:5232',
  );

  assert.equal(g6GatewayResourceIdentityMatches(internal, external), true);
  assert.equal(g6GatewayResourceIdentityMatches(external, external), false);
  assert.equal(
    g6GatewayResourceIdentityMatches(
      internal.replace('01234567-89ab', '11234567-89ab'),
      external,
    ),
    false,
  );
});

test('rejects foreign origins, collection paths, and decorated G6 hrefs', () => {
  const external =
    'http://127.0.0.1:5233/_matrix_calendar_service/element-acceptance/g6-01234567-89ab-cdef-0123-456789abcdef.ics';
  const internal =
    'http://restore-radicale:5232/_matrix_calendar_service/element-acceptance/g6-01234567-89ab-cdef-0123-456789abcdef.ics';

  for (const candidate of [
    internal.replace('restore-radicale:5232', 'restore-radicale.evil:5232'),
    internal.replace('/element-acceptance/', '/other/'),
    `${internal}?download=1`,
    `${internal}#fragment`,
    external.replace('127.0.0.1:5233', '127.0.0.1:5232'),
  ]) {
    assert.equal(g6GatewayResourceIdentityMatches(candidate, external), false);
  }
});

function start(name = 'private-resource-name.ics') {
  const resource = createG6ResourceOwnership(name);
  assert.equal(beginG6ResourceCreate(resource), true);
  return resource;
}

test('strong ETag diagnostics use the same bounded validator as ownership', () => {
  assert.equal(isStrongG6ResourceEtag('"strong-tag"'), true);
  assert.equal(isStrongG6ResourceEtag('W/"weak-tag"'), false);
  assert.equal(isStrongG6ResourceEtag('"bad\nvalue"'), false);
  assert.equal(isStrongG6ResourceEtag(undefined), false);
});

test('a pre-existing conditional-create collision is never adopted or deleted', () => {
  const resource = start();
  assert.equal(recordG6ResourceCreate(resource, 412, undefined), false);
  assert.deepEqual(g6ResourceCleanupRequest(resource), { method: 'skip' });
  assert.deepEqual(summarizeG6ResourceOwnership([resource]), {
    plannedCount: 1,
    confirmedCreatedCount: 0,
    conflictCount: 1,
    notCreatedCount: 0,
    createUnresolvedCount: 0,
    deletedCount: 0,
    alreadyAbsentCount: 0,
    cleanupUnresolvedCount: 0,
    count: 0,
    allOwnedResourcesRemoved: true,
  });
});

test('an ambiguous create outcome is not followed by a conditional delete guess', () => {
  const resource = start();
  assert.equal(recordG6ResourceCreate(resource, undefined, undefined), false);
  assert.deepEqual(g6ResourceCleanupRequest(resource), { method: 'skip' });
  assert.equal(
    summarizeG6ResourceOwnership([resource]).allOwnedResourcesRemoved,
    false,
  );
});

test('only a confirmed strong ETag authorizes conditional cleanup', () => {
  const resource = start();
  assert.equal(recordG6ResourceCreate(resource, 201, '"strong-tag"'), true);
  assert.deepEqual(g6ResourceCleanupRequest(resource), {
    method: 'DELETE',
    ifMatch: '"strong-tag"',
  });
  assert.equal(recordG6ResourceCleanup(resource, 412), false);
  assert.deepEqual(g6ResourceCleanupRequest(resource), { method: 'skip' });
  const summary = summarizeG6ResourceOwnership([resource]);
  assert.equal(summary.confirmedCreatedCount, 1);
  assert.equal(summary.cleanupUnresolvedCount, 1);
  assert.equal(summary.allOwnedResourcesRemoved, false);
});

test('a confirmed update replaces the cleanup validator before deleting', () => {
  const resource = start();
  assert.equal(recordG6ResourceCreate(resource, 201, '"created-v1"'), true);
  assert.equal(
    recordG6ResourceUpdate(resource, 200, '"updated-v2"', true),
    true,
  );
  assert.deepEqual(g6ResourceCleanupRequest(resource), {
    method: 'DELETE',
    ifMatch: '"updated-v2"',
  });
  assert.equal(recordG6ResourceCleanup(resource, 204), true);
  assert.equal(
    summarizeG6ResourceOwnership([resource]).allOwnedResourcesRemoved,
    true,
  );
});

test('an update response for a different resource cannot replace its validator', () => {
  const resource = start();
  assert.equal(recordG6ResourceCreate(resource, 201, '"created-v1"'), true);
  assert.equal(
    recordG6ResourceUpdate(resource, 200, '"other-resource-v2"', false),
    false,
  );
  assert.deepEqual(g6ResourceCleanupRequest(resource), { method: 'skip' });
});

test('an ambiguous update never authorizes deletion with the stale validator', () => {
  const resource = start();
  assert.equal(recordG6ResourceCreate(resource, 201, '"created-v1"'), true);
  assert.equal(recordG6ResourceUpdate(resource, 200, undefined, true), false);
  assert.deepEqual(g6ResourceCleanupRequest(resource), { method: 'skip' });
  assert.equal(
    summarizeG6ResourceOwnership([resource]).allOwnedResourcesRemoved,
    false,
  );
});

test('a successful conditional delete and an already-absent owned object close safely', () => {
  const removed = start('private-a.ics');
  assert.equal(recordG6ResourceCreate(removed, 201, '"a"'), true);
  assert.equal(recordG6ResourceCleanup(removed, 204), true);
  const absent = start('private-b.ics');
  assert.equal(recordG6ResourceCreate(absent, 201, '"b"'), true);
  assert.equal(recordG6ResourceCleanup(absent, 404), true);
  const summary = summarizeG6ResourceOwnership([removed, absent]);
  assert.equal(summary.count, 2);
  assert.equal(summary.confirmedCreatedCount, 2);
  assert.equal(summary.allOwnedResourcesRemoved, true);
});

test('success without a usable strong ETag remains unresolved and is not deleted', () => {
  const resource = start();
  assert.equal(recordG6ResourceCreate(resource, 201, 'W/"weak"'), false);
  assert.deepEqual(g6ResourceCleanupRequest(resource), { method: 'skip' });
  const summary = summarizeG6ResourceOwnership([resource]);
  assert.equal(summary.createUnresolvedCount, 1);
  assert.equal(summary.allOwnedResourcesRemoved, false);
});
