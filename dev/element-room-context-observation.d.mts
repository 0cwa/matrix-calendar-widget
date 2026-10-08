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

export function roomContextObservationForPhase<T extends object>(
  observation: T,
  phase: MemberRoomContextPhase,
): T | Omit<T, RoomRenderDiagnosticField>;
