export type G6ResourceOwnership = {
  name: string;
  state:
    | 'not-attempted'
    | 'creating'
    | 'created'
    | 'conflict'
    | 'rejected'
    | 'create-unresolved'
    | 'deleted'
    | 'absent'
    | 'cleanup-unresolved';
  etag?: string;
  confirmedCreated: boolean;
};

export function g6EventSummaryMatches(
  bytes: Buffer,
  expectedTitle: string,
): boolean | undefined;

export function g6GatewayResourceIdentityMatches(
  gatewayEventHref: string,
  externallyOwnedResourceHref: string,
): boolean;
export function createG6ResourceOwnership(name: string): G6ResourceOwnership;
export function isStrongG6ResourceEtag(etag: unknown): etag is string;
export function beginG6ResourceCreate(resource: G6ResourceOwnership): boolean;
export function recordG6ResourceCreate(
  resource: G6ResourceOwnership,
  status: number | undefined,
  etag: string | undefined,
): boolean;
export function recordG6ResourceUpdate(
  resource: G6ResourceOwnership,
  status: number | undefined,
  etag: string | undefined,
  identityMatches: boolean,
): boolean;
export function g6ResourceCleanupRequest(
  resource: G6ResourceOwnership,
): { method: 'DELETE'; ifMatch: string } | { method: 'skip' };
export function recordG6ResourceCleanup(
  resource: G6ResourceOwnership,
  status: number | undefined,
): boolean;
export function summarizeG6ResourceOwnership(
  resources: G6ResourceOwnership[],
): {
  plannedCount: number;
  confirmedCreatedCount: number;
  conflictCount: number;
  notCreatedCount: number;
  createUnresolvedCount: number;
  deletedCount: number;
  alreadyAbsentCount: number;
  cleanupUnresolvedCount: number;
  count: number;
  allOwnedResourcesRemoved: boolean;
};
