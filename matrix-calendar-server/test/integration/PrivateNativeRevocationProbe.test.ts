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

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  PrivateNativeRevocationProbe,
  type NativeRevocationProbeRequest,
} from './PrivateNativeRevocationProbe';

const APP_ID = 'mcwpc~synthetic-app-id';
const SECRET = 'synthetic-secret-not-for-output';
const UID = 'private-native-revoke-0123456789abcdef0123456789abcdef';
const TARGET_PATH = `/${APP_ID}/calendar/${UID}.ics`;
const MARKER = `private-revoke-marker-${UID}`;
const OPAQUE_PROPERTY =
  'X-COMPANY-OPAQUE;X-KEEP=attribute:probe-keep-this-value';
const BASELINE = Buffer.from(
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${UID}\r\nSUMMARY:Canonical probe baseline\r\n${OPAQUE_PROPERTY}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
);

function armedProbe(): PrivateNativeRevocationProbe {
  const probe = new PrivateNativeRevocationProbe(TARGET_PATH, APP_ID, SECRET);
  expect(probe.markProviderItemLoaded()).toBe(true);
  expect(
    probe.captureCanonicalBaseline(BASELINE, UID, OPAQUE_PROPERTY, MARKER),
  ).toBe(true);
  expect(probe.commitTombstone()).toBe(true);
  expect(probe.arm()).toBe(true);
  return probe;
}

function denyExpectedNativePut(
  probe: PrivateNativeRevocationProbe,
): NativeRevocationProbeRequest {
  const request = probe.beginRequest('PUT', TARGET_PATH, false);
  if (!request) throw new Error('probe request was not recognized');
  probe.recordAuthentication(request, APP_ID, SECRET, true, false);
  probe.finishRequest(request, 401);
  return request;
}

describe('private native revocation probe receipt', () => {
  it('requires provider load, canonical opaque baseline, tombstone, then arm', () => {
    const probe = new PrivateNativeRevocationProbe(TARGET_PATH, APP_ID, SECRET);
    expect(probe.arm()).toBe(false);
    expect(probe.commitTombstone()).toBe(false);
    expect(
      probe.captureCanonicalBaseline(BASELINE, UID, OPAQUE_PROPERTY, MARKER),
    ).toBe(false);
    expect(probe.markProviderItemLoaded()).toBe(true);
    const staleMarkerBaseline = Buffer.from(
      BASELINE.toString('utf8').replace('Canonical probe baseline', MARKER),
    );
    expect(
      probe.captureCanonicalBaseline(
        staleMarkerBaseline,
        UID,
        OPAQUE_PROPERTY,
        MARKER,
      ),
    ).toBe(false);
    expect(
      probe.captureCanonicalBaseline(BASELINE, UID, OPAQUE_PROPERTY, MARKER),
    ).toBe(true);
    expect(
      probe.captureCanonicalBaseline(BASELINE, UID, OPAQUE_PROPERTY, MARKER),
    ).toBe(false);
    expect(probe.arm()).toBe(false);
    expect(probe.commitTombstone()).toBe(true);
    expect(probe.arm()).toBe(true);
    expect(probe.state().proofPassed).toBe(false);
  });

  it('passes only an exact post-tombstone PUT denied for the expected revoked credential and unchanged canonical item', () => {
    const probe = armedProbe();
    denyExpectedNativePut(probe);
    expect(
      probe.verifyCanonicalAfterDenial(BASELINE, OPAQUE_PROPERTY, MARKER),
    ).toBe(true);
    expect(probe.state()).toMatchObject({
      baselineReady: true,
      baselineOpaquePresent: true,
      providerItemLoadedBeforeTombstone: true,
      tombstoneCommitted: true,
      armedAfterTombstone: true,
      noEarlierProbePut: true,
      nativePutObserved: true,
      exactCredentialMatched: true,
      revokedPolicyDenied: true,
      deniedResponseObserved: true,
      acceptedProbeObserved: false,
      canonicalUnchanged: true,
      responseClass: 'unauthorized',
      proofPassed: true,
    });
  });

  it('does not treat the provider GET used to load the probe as an accepted write', () => {
    const probe = new PrivateNativeRevocationProbe(TARGET_PATH, APP_ID, SECRET);
    const loadRequest = probe.beginRequest('GET', TARGET_PATH, false);
    expect(loadRequest).toBeDefined();
    if (!loadRequest) throw new Error('probe request was not recognized');
    probe.recordAuthentication(loadRequest, APP_ID, SECRET, false, true);
    probe.finishRequest(loadRequest, 200);
    expect(probe.state().acceptedProbeObserved).toBe(false);

    expect(probe.markProviderItemLoaded()).toBe(true);
    expect(
      probe.captureCanonicalBaseline(BASELINE, UID, OPAQUE_PROPERTY, MARKER),
    ).toBe(true);
    expect(probe.commitTombstone()).toBe(true);
    expect(probe.arm()).toBe(true);
    denyExpectedNativePut(probe);
    expect(
      probe.verifyCanonicalAfterDenial(BASELINE, OPAQUE_PROPERTY, MARKER),
    ).toBe(true);
    expect(probe.state().proofPassed).toBe(true);
  });

  it('keeps the policy decision bound to the same asynchronous ingress request', async () => {
    const probe = armedProbe();
    const request = probe.beginRequest('PUT', TARGET_PATH, false);
    if (!request) throw new Error('probe request was not recognized');
    const requestContext = new AsyncLocalStorage<typeof request>();
    await requestContext.run(request, async () => {
      await Promise.resolve();
      const context = requestContext.getStore();
      if (!context) throw new Error('request context was lost');
      probe.recordAuthentication(context, APP_ID, SECRET, true, false);
    });
    probe.finishRequest(request, 403);
    expect(
      probe.verifyCanonicalAfterDenial(BASELINE, OPAQUE_PROPERTY, MARKER),
    ).toBe(true);
    expect(probe.state()).toMatchObject({
      exactCredentialMatched: true,
      revokedPolicyDenied: true,
      deniedResponseObserved: true,
      responseClass: 'forbidden',
      proofPassed: true,
    });
  });

  it('rejects wrong credentials, non-PUT methods, or a changed canonical object', () => {
    const wrongPath = armedProbe();
    expect(
      wrongPath.beginRequest('PUT', `${TARGET_PATH}.sibling`, false),
    ).toBeUndefined();

    const wrongCredential = armedProbe();
    const wrongCredentialRequest = wrongCredential.beginRequest(
      'PUT',
      TARGET_PATH,
      false,
    );
    if (!wrongCredentialRequest)
      throw new Error('probe request was not recognized');
    wrongCredential.recordAuthentication(
      wrongCredentialRequest,
      APP_ID,
      'other-secret',
      true,
      false,
    );
    wrongCredential.finishRequest(wrongCredentialRequest, 401);
    wrongCredential.verifyCanonicalAfterDenial(
      BASELINE,
      OPAQUE_PROPERTY,
      MARKER,
    );
    expect(wrongCredential.state().proofPassed).toBe(false);

    const wrongAppId = armedProbe();
    const wrongAppIdRequest = wrongAppId.beginRequest(
      'PUT',
      TARGET_PATH,
      false,
    );
    if (!wrongAppIdRequest) throw new Error('probe request was not recognized');
    wrongAppId.recordAuthentication(
      wrongAppIdRequest,
      'mcwpc~different-synthetic-id',
      SECRET,
      true,
      false,
    );
    wrongAppId.finishRequest(wrongAppIdRequest, 401);
    wrongAppId.verifyCanonicalAfterDenial(BASELINE, OPAQUE_PROPERTY, MARKER);
    expect(wrongAppId.state().proofPassed).toBe(false);

    const query = armedProbe();
    const queryRequest = query.beginRequest('PUT', TARGET_PATH, true);
    if (!queryRequest) throw new Error('probe request was not recognized');
    query.recordAuthentication(queryRequest, APP_ID, SECRET, true, false);
    query.finishRequest(queryRequest, 401);
    query.verifyCanonicalAfterDenial(BASELINE, OPAQUE_PROPERTY, MARKER);
    expect(query.state().proofPassed).toBe(false);
    expect(query.state().responseClass).toBe('not_seen');

    const nonPut = armedProbe();
    const getRequest = nonPut.beginRequest('GET', TARGET_PATH, false);
    expect(getRequest).toBeDefined();
    if (getRequest) nonPut.finishRequest(getRequest, 401);
    expect(nonPut.state().nativePutObserved).toBe(false);
    expect(nonPut.state().proofPassed).toBe(false);

    const changedCanonical = armedProbe();
    denyExpectedNativePut(changedCanonical);
    const changed = Buffer.from(
      BASELINE.toString('utf8').replace('Canonical probe baseline', MARKER),
    );
    expect(
      changedCanonical.verifyCanonicalAfterDenial(
        changed,
        OPAQUE_PROPERTY,
        MARKER,
      ),
    ).toBe(false);
    expect(changedCanonical.state().proofPassed).toBe(false);
  });

  it('rejects an earlier or in-flight PUT when arming and any accepted probe write', () => {
    const earlier = new PrivateNativeRevocationProbe(
      TARGET_PATH,
      APP_ID,
      SECRET,
    );
    expect(earlier.markProviderItemLoaded()).toBe(true);
    expect(
      earlier.captureCanonicalBaseline(BASELINE, UID, OPAQUE_PROPERTY, MARKER),
    ).toBe(true);
    const earlyRequest = earlier.beginRequest('PUT', TARGET_PATH, false);
    expect(earlyRequest).toBeDefined();
    expect(earlier.commitTombstone()).toBe(true);
    expect(earlier.arm()).toBe(false);
    if (earlyRequest) earlier.finishRequest(earlyRequest, 401);
    expect(earlier.state().noEarlierProbePut).toBe(false);
    expect(earlier.state().proofPassed).toBe(false);

    const accepted = armedProbe();
    const acceptedRequest = accepted.beginRequest('PUT', TARGET_PATH, false);
    expect(acceptedRequest).toBeDefined();
    if (!acceptedRequest) throw new Error('probe request was not recognized');
    accepted.recordAuthentication(acceptedRequest, APP_ID, SECRET, true, true);
    accepted.finishRequest(acceptedRequest, 204);
    accepted.verifyCanonicalAfterDenial(BASELINE, OPAQUE_PROPERTY, MARKER);
    expect(accepted.state().acceptedProbeObserved).toBe(true);
    expect(accepted.state().proofPassed).toBe(false);

    const unexpectedStatus = armedProbe();
    const failedRequest = unexpectedStatus.beginRequest(
      'PUT',
      TARGET_PATH,
      false,
    );
    if (!failedRequest) throw new Error('probe request was not recognized');
    unexpectedStatus.recordAuthentication(
      failedRequest,
      APP_ID,
      SECRET,
      true,
      false,
    );
    unexpectedStatus.finishRequest(failedRequest, 500);
    unexpectedStatus.verifyCanonicalAfterDenial(
      BASELINE,
      OPAQUE_PROPERTY,
      MARKER,
    );
    expect(unexpectedStatus.state().responseClass).toBe('other');
    expect(unexpectedStatus.state().proofPassed).toBe(false);
  });

  it('does not serialize the URI marker, credential ID, or secret', () => {
    const probe = armedProbe();
    denyExpectedNativePut(probe);
    probe.verifyCanonicalAfterDenial(BASELINE, OPAQUE_PROPERTY, MARKER);
    const receipt = JSON.stringify(probe.state());
    expect(receipt).not.toContain(TARGET_PATH);
    expect(receipt).not.toContain(APP_ID);
    expect(receipt).not.toContain(SECRET);
    expect(receipt).not.toContain(UID);
    expect(receipt).not.toContain(MARKER);
  });
});
