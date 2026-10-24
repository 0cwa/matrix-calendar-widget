import { createHash, timingSafeEqual } from 'node:crypto';

const DENIED_HTTP_STATUSES = new Set([401, 403]);
const MAX_PROBE_PUTS = 4;

export type NativeRevocationProbeRequest = {
  readonly sequence: number;
  readonly method: string;
  readonly exactHref: boolean;
  readonly tombstoneAtIngress: boolean;
  readonly armedAtIngress: boolean;
  authenticationObserved: boolean;
  credentialMatched: boolean;
  revokedRecordMatched: boolean;
  policyDenied: boolean;
  authenticationAmbiguous: boolean;
};

export type NativeRevocationProbeState = Readonly<{
  baselineReady: boolean;
  baselineOpaquePresent: boolean;
  providerItemLoadedBeforeTombstone: boolean;
  tombstoneCommitted: boolean;
  armedAfterTombstone: boolean;
  noEarlierProbePut: boolean;
  nativePutObserved: boolean;
  exactCredentialMatched: boolean;
  revokedPolicyDenied: boolean;
  deniedResponseObserved: boolean;
  acceptedProbeObserved: boolean;
  canonicalUnchanged: boolean;
  responseClass:
    | 'not_seen'
    | 'unauthorized'
    | 'forbidden'
    | 'accepted'
    | 'other'
    | 'mixed';
  proofPassed: boolean;
}>;

/** Run-local evidence for one unique native post-revocation resource. */
export class PrivateNativeRevocationProbe {
  private readonly targetPath: string;
  private readonly expectedAppId: string;
  private readonly expectedSecret: string;
  private baselineDigest: Buffer | undefined;
  private baselineOpaquePresent = false;
  private baselineReady = false;
  private providerItemLoadedBeforeTombstone = false;
  private tombstoneCommitted = false;
  private armedAfterTombstone = false;
  private noEarlierProbePut = false;
  private activeProbePuts = 0;
  private probePutsBeforeArm = 0;
  private sequence = 0;
  private tombstoneSequence = 0;
  private armSequence = 0;
  private nativePutObserved = false;
  private exactCredentialMatched = false;
  private revokedPolicyDenied = false;
  private deniedResponseObserved = false;
  private acceptedProbeObserved = false;
  private canonicalUnchanged = false;
  private unexpectedOutcome = false;
  private requestOverflow = false;
  private probePutCount = 0;
  private responseClass: NativeRevocationProbeState['responseClass'] =
    'not_seen';

  constructor(
    targetPath: string,
    expectedAppId: string,
    expectedSecret: string,
  ) {
    this.targetPath = targetPath;
    this.expectedAppId = expectedAppId;
    this.expectedSecret = expectedSecret;
  }

  captureCanonicalBaseline(
    body: Uint8Array,
    eventUid: string,
    expectedOpaqueProperty: string,
    probeMarker: string,
  ): boolean {
    if (
      this.baselineReady ||
      this.tombstoneCommitted ||
      this.armedAfterTombstone ||
      !this.providerItemLoadedBeforeTombstone
    ) {
      return false;
    }
    const bytes = Buffer.from(body);
    const hasUid = bytes.includes(Buffer.from(`UID:${eventUid}`));
    const hasOpaque = bytes.includes(Buffer.from(expectedOpaqueProperty));
    const markerAbsent = !bytes.includes(Buffer.from(probeMarker));
    if (!hasUid || !hasOpaque || !markerAbsent) return false;
    this.baselineDigest = createHash('sha256').update(bytes).digest();
    this.baselineOpaquePresent = true;
    this.baselineReady = true;
    return true;
  }

  markProviderItemLoaded(): boolean {
    if (this.tombstoneCommitted || this.armedAfterTombstone) return false;
    this.providerItemLoadedBeforeTombstone = true;
    return true;
  }

  commitTombstone(): boolean {
    if (
      this.tombstoneCommitted ||
      !this.providerItemLoadedBeforeTombstone ||
      !this.baselineReady
    ) {
      return false;
    }
    this.tombstoneCommitted = true;
    this.tombstoneSequence = ++this.sequence;
    return true;
  }

  arm(): boolean {
    if (
      this.armedAfterTombstone ||
      !this.baselineReady ||
      !this.providerItemLoadedBeforeTombstone ||
      !this.tombstoneCommitted
    ) {
      return false;
    }
    this.noEarlierProbePut =
      this.probePutsBeforeArm === 0 && this.activeProbePuts === 0;
    if (!this.noEarlierProbePut) return false;
    this.armedAfterTombstone = true;
    this.armSequence = ++this.sequence;
    return true;
  }

  beginRequest(
    method: string,
    pathname: string,
    hasQueryOrFragment: boolean,
  ): NativeRevocationProbeRequest | undefined {
    if (pathname !== this.targetPath) return undefined;
    const normalizedMethod = method.toUpperCase();
    const sequence = ++this.sequence;
    const request: NativeRevocationProbeRequest = {
      sequence,
      method: normalizedMethod,
      exactHref: !hasQueryOrFragment,
      tombstoneAtIngress:
        this.tombstoneCommitted && sequence > this.tombstoneSequence,
      armedAtIngress: this.armedAfterTombstone && sequence > this.armSequence,
      authenticationObserved: false,
      credentialMatched: false,
      revokedRecordMatched: false,
      policyDenied: false,
      authenticationAmbiguous: false,
    };
    if (normalizedMethod === 'PUT') {
      this.probePutCount += 1;
      this.activeProbePuts += 1;
      if (!this.tombstoneCommitted || !this.armedAfterTombstone) {
        this.probePutsBeforeArm += 1;
      } else {
        this.nativePutObserved = true;
      }
      if (this.probePutCount > MAX_PROBE_PUTS) this.requestOverflow = true;
    }
    return request;
  }

  recordAuthentication(
    request: NativeRevocationProbeRequest,
    appId: unknown,
    secret: unknown,
    recordRevoked: boolean,
    allowed: boolean,
  ): void {
    if (request.authenticationObserved) {
      request.authenticationAmbiguous = true;
      this.unexpectedOutcome = true;
      return;
    }
    request.authenticationObserved = true;
    request.credentialMatched =
      typeof appId === 'string' &&
      appId === this.expectedAppId &&
      typeof secret === 'string' &&
      this.secretMatches(secret);
    request.revokedRecordMatched = request.credentialMatched && recordRevoked;
    request.policyDenied = request.revokedRecordMatched && !allowed;
    if (
      request.method === 'PUT' &&
      request.credentialMatched &&
      request.tombstoneAtIngress
    ) {
      this.exactCredentialMatched = true;
    }
    if (
      request.method === 'PUT' &&
      request.policyDenied &&
      request.armedAtIngress
    ) {
      this.revokedPolicyDenied = true;
    }
    if (
      request.method === 'PUT' &&
      request.credentialMatched &&
      request.tombstoneAtIngress &&
      allowed
    ) {
      this.acceptedProbeObserved = true;
    }
  }

  finishRequest(request: NativeRevocationProbeRequest, status: number): void {
    if (request.method === 'PUT') {
      this.activeProbePuts = Math.max(0, this.activeProbePuts - 1);
    }
    if (request.method !== 'PUT' || !request.tombstoneAtIngress) return;
    if (!request.armedAtIngress || !request.exactHref) {
      this.unexpectedOutcome = true;
      return;
    }
    if (status >= 200 && status < 300) {
      this.acceptedProbeObserved = true;
      this.recordResponseClass('accepted');
      return;
    }
    if (
      request.credentialMatched &&
      request.revokedRecordMatched &&
      request.policyDenied &&
      DENIED_HTTP_STATUSES.has(status)
    ) {
      this.deniedResponseObserved = true;
      this.recordResponseClass(status === 401 ? 'unauthorized' : 'forbidden');
      return;
    }
    if (!DENIED_HTTP_STATUSES.has(status)) {
      this.unexpectedOutcome = true;
      if (request.credentialMatched) this.recordResponseClass('other');
    }
  }

  verifyCanonicalAfterDenial(
    body: Uint8Array,
    expectedOpaqueProperty: string,
    probeMarker: string,
  ): boolean {
    if (!this.baselineDigest || !this.deniedResponseObserved) return false;
    const bytes = Buffer.from(body);
    const digest = createHash('sha256').update(bytes).digest();
    const sameDigest = timingSafeEqual(this.baselineDigest, digest);
    this.canonicalUnchanged =
      sameDigest &&
      bytes.includes(Buffer.from(expectedOpaqueProperty)) &&
      !bytes.includes(Buffer.from(probeMarker));
    return this.canonicalUnchanged;
  }

  state(): NativeRevocationProbeState {
    const proofPassed =
      this.baselineReady &&
      this.baselineOpaquePresent &&
      this.providerItemLoadedBeforeTombstone &&
      this.tombstoneCommitted &&
      this.armedAfterTombstone &&
      this.noEarlierProbePut &&
      this.nativePutObserved &&
      this.exactCredentialMatched &&
      this.revokedPolicyDenied &&
      this.deniedResponseObserved &&
      !this.acceptedProbeObserved &&
      this.canonicalUnchanged &&
      !this.unexpectedOutcome &&
      !this.requestOverflow;
    return {
      baselineReady: this.baselineReady,
      baselineOpaquePresent: this.baselineOpaquePresent,
      providerItemLoadedBeforeTombstone: this.providerItemLoadedBeforeTombstone,
      tombstoneCommitted: this.tombstoneCommitted,
      armedAfterTombstone: this.armedAfterTombstone,
      noEarlierProbePut: this.noEarlierProbePut,
      nativePutObserved: this.nativePutObserved,
      exactCredentialMatched: this.exactCredentialMatched,
      revokedPolicyDenied: this.revokedPolicyDenied,
      deniedResponseObserved: this.deniedResponseObserved,
      acceptedProbeObserved: this.acceptedProbeObserved,
      canonicalUnchanged: this.canonicalUnchanged,
      responseClass: this.responseClass,
      proofPassed,
    };
  }

  private secretMatches(secret: string): boolean {
    const actual = Buffer.from(secret, 'utf8');
    const expected = Buffer.from(this.expectedSecret, 'utf8');
    return (
      actual.byteLength === expected.byteLength &&
      timingSafeEqual(actual, expected)
    );
  }

  private recordResponseClass(
    next: Exclude<
      NativeRevocationProbeState['responseClass'],
      'not_seen' | 'mixed'
    >,
  ): void {
    if (this.responseClass === 'not_seen') {
      this.responseClass = next;
    } else if (this.responseClass !== next) {
      this.responseClass = 'mixed';
      this.unexpectedOutcome = true;
    }
  }
}
