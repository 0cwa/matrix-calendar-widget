export type MemberRoomContextPhase =
  | 'member-a-room-context'
  | 'reminder-room-context'
  | 'g6-member-a-room-context'
  | 'g6-member-b-room-context';

export type RoomRenderDiagnosticField =
  | 'outerRenderBucket'
  | 'matrixChatShellPresent'
  | 'roomViewWrapperPresent'
  | 'roomViewRendererPresent'
  | 'matrixChatStateAvailable'
  | 'matrixChatViewBucket'
  | 'matrixChatReady'
  | 'matrixChatPageTypeBucket'
  | 'matrixChatCurrentRoomMatches'
  | 'roomRenderStateAvailable'
  | 'roomViewShellVisible'
  | 'roomViewBodyVisible'
  | 'roomPreviewVisible'
  | 'roomPreviewLoadingVisible'
  | 'roomHeaderVisible'
  | 'roomHeaderHeadingVisible'
  | 'roomErrorBoundaryVisible';

export type RoomReadinessSyncState =
  | 'ERROR'
  | 'PREPARED'
  | 'RECONNECTING'
  | 'STOPPED'
  | 'SYNCING'
  | 'CATCHUP'
  | 'UNKNOWN';

export type RoomReadinessSnapshot = {
  roomViewPresent: boolean;
  roomHeaderPresent: boolean;
  roomHeadingPresent: boolean;
  currentRoomMatches: boolean | null;
  matrixSyncState: RoomReadinessSyncState;
};

export type RoomReadinessSample = {
  elapsedMs: number;
  available: boolean;
  roomViewPresent: boolean | null;
  roomHeaderPresent: boolean | null;
  roomHeadingPresent: boolean | null;
  currentRoomMatches: boolean | null;
  matrixSyncState: RoomReadinessSyncState;
};

export type RoomReadinessTimeline = {
  outcome: 'cancelled' | 'budget-exhausted' | 'unavailable' | 'not-started';
  sampleCountCapped: number;
  overflow: boolean;
  samples: RoomReadinessSample[];
};

export const ROOM_READINESS_SAMPLE_MAX_COUNT: 15;
export const ROOM_READINESS_SAMPLE_MAX_DURATION_MS: 15_000;
export const ROOM_READINESS_SAMPLE_TIMEOUT_MS: 350;

export function unavailableRoomReadinessTimeline(
  outcome?: 'unavailable' | 'not-started',
): RoomReadinessTimeline;

export function collectRoomReadinessTimeline(input: {
  observe: () => RoomReadinessSnapshot | Promise<RoomReadinessSnapshot>;
  signal: AbortSignal;
}): Promise<RoomReadinessTimeline>;

export function roomContextObservationForPhase<T extends object>(
  observation: T,
  phase: MemberRoomContextPhase,
): T | Omit<T, RoomRenderDiagnosticField | 'roomReadinessTimeline'>;
