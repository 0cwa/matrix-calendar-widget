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
  | 'matrixChatFirstSyncComplete'
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

export const ROOM_RENDER_DIAGNOSTIC_FIELDS: readonly RoomRenderDiagnosticField[];

export type RoomReadinessSyncState =
  | 'ERROR'
  | 'PREPARED'
  | 'RECONNECTING'
  | 'STOPPED'
  | 'SYNCING'
  | 'CATCHUP'
  | 'UNKNOWN';

export type RoomNavigationPageType =
  | 'room-view'
  | 'other-page'
  | 'missing'
  | 'unavailable';

export type RoomNavigationReadinessSnapshot = {
  firstSyncComplete: boolean | null;
  ready: boolean | null;
  pageType: RoomNavigationPageType;
  currentRoomMatches: boolean | null;
  matrixSyncState: RoomReadinessSyncState;
};

export type RoomNavigationReadinessObservation = {
  beforeNavigation: RoomNavigationReadinessSnapshot;
  afterRoute: RoomNavigationReadinessSnapshot;
};

export type RoomReadinessSnapshot = {
  roomViewPresent: boolean;
  roomHeaderPresent: boolean;
  roomHeadingPresent: boolean;
  currentRoomMatches: boolean | null;
  matrixSyncState: RoomReadinessSyncState;
  matrixChatFirstSyncComplete?: boolean | null;
  matrixChatReady?: boolean | null;
  matrixChatPageTypeBucket?: RoomNavigationPageType;
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

export function normalizeRoomNavigationReadinessSnapshot(
  value: unknown,
): RoomNavigationReadinessSnapshot;

export function createRoomNavigationReadinessObservation(
  beforeNavigation: unknown,
  afterRoute: unknown,
): RoomNavigationReadinessObservation;

export function isRoomNavigationReadinessObservation(
  value: unknown,
): value is RoomNavigationReadinessObservation;

export function isElementRoomEntryReady(
  snapshotValue: unknown,
  identityAndRoomValue: unknown,
): boolean;

export function roomContextObservationForPhase<T extends object>(
  observation: T,
  phase: MemberRoomContextPhase,
):
  | T
  | Omit<
      T,
      | RoomRenderDiagnosticField
      | 'roomReadinessTimeline'
      | 'roomNavigationReadiness'
    >;

export function createMemberRoomContextRecord<T extends object>(
  result: {
    failureCode?: string;
    observation?: T;
    roomReadinessTimeline?: RoomReadinessTimeline;
    roomNavigationReadiness?: RoomNavigationReadinessObservation;
  },
  phase: MemberRoomContextPhase,
  reminderWidgetContext?: object,
): Record<string, unknown>;
