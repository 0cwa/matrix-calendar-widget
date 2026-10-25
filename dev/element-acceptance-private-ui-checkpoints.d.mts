export type PrivateUiCheckpointPhase =
  | 'private-ui-fixture-ready'
  | 'private-ui-member-a-auth'
  | 'private-ui-member-a-room'
  | 'private-ui-member-a-widget-ready'
  | 'private-ui-access-button-visible'
  | 'private-ui-access-button-enabled'
  | 'private-ui-access-button-click'
  | 'private-ui-dialog-visible'
  | 'private-ui-initial-list'
  | 'private-ui-calendar-picker-open'
  | 'private-ui-calendar-option-unique'
  | 'private-ui-calendar-selection'
  | 'private-ui-calendar-selection-complete'
  | 'private-ui-credential-issue-reveal'
  | 'private-ui-no-publication'
  | 'private-ui-credential-hide'
  | 'private-ui-storage-check'
  | 'private-ui-list-reopen'
  | 'private-ui-dav-principal-discovery'
  | 'private-ui-dav-collection-discovery'
  | 'private-ui-dav-create'
  | 'private-ui-dav-read-created'
  | 'private-ui-dav-update'
  | 'private-ui-dav-read-updated'
  | 'private-ui-dav-delete'
  | 'private-ui-dav-cleanup'
  | 'private-ui-member-b-auth'
  | 'private-ui-member-b-room'
  | 'private-ui-member-b-widget-ready'
  | 'private-ui-member-b-deny'
  | 'private-ui-outsider-auth'
  | 'private-ui-outsider-room'
  | 'private-ui-outsider-widget-ready'
  | 'private-ui-outsider-deny'
  | 'private-ui-revoke'
  | 'private-ui-dav-deny-after-revoke'
  | 'private-ui-egress-check'
  | 'private-ui-context-cleanup';
export type PrivateUiCleanupPhase =
  | 'private-ui-dav-cleanup'
  | 'private-ui-context-cleanup';

export type PrivateUiCalendarListEndpoint =
  | 'personal-list'
  | 'room-context'
  | 'room-list';
export type PrivateUiCalendarListMethod = 'GET' | 'OPTIONS';
export type PrivateUiCalendarListFailureCategory =
  | 'blocked'
  | 'dns'
  | 'tls'
  | 'timeout'
  | 'connection'
  | 'other';
export type PrivateUiCalendarListTransportObservation =
  | Readonly<{
      endpoint: PrivateUiCalendarListEndpoint;
      method: PrivateUiCalendarListMethod;
      outcome: 'pending';
    }>
  | Readonly<{
      endpoint: PrivateUiCalendarListEndpoint;
      method: PrivateUiCalendarListMethod;
      outcome: 'response';
      httpStatus: number;
    }>
  | Readonly<{
      endpoint: PrivateUiCalendarListEndpoint;
      method: PrivateUiCalendarListMethod;
      outcome: 'network-failure';
      networkFailure: PrivateUiCalendarListFailureCategory;
    }>;

export declare const PRIVATE_UI_CHECKPOINT_PHASES: readonly PrivateUiCheckpointPhase[];
export declare const PRIVATE_UI_RESULT_PHASE: 'private-ui-test-result';
export declare const PRIVATE_UI_CALENDAR_LIST_TRANSPORT_PHASE: 'private-ui-calendar-list-transport';
export declare const PRIVATE_UI_CALENDAR_LIST_ENDPOINTS: readonly PrivateUiCalendarListEndpoint[];
export declare const PRIVATE_UI_CALENDAR_LIST_METHODS: readonly PrivateUiCalendarListMethod[];
export declare const PRIVATE_UI_CALENDAR_LIST_FAILURE_CATEGORIES: readonly PrivateUiCalendarListFailureCategory[];
export declare const PRIVATE_UI_CALENDAR_LIST_OBSERVATION_LIMIT: 6;
export declare function classifyPrivateUiCalendarListNetworkFailure(
  errorText: unknown,
): PrivateUiCalendarListFailureCategory;
export declare function normalizePrivateUiCalendarListTransportObservations(
  observations: unknown,
): PrivateUiCalendarListTransportObservation[] | undefined;

export interface PrivateUiCheckpointJournal {
  run<T>(
    phase: PrivateUiCheckpointPhase,
    operation: () => Promise<T> | T,
  ): Promise<T>;
  cleanup<T>(
    phase: PrivateUiCleanupPhase,
    operation: () => Promise<T> | T,
  ): Promise<T | undefined>;
  recordCalendarListTransport(
    observations: readonly PrivateUiCalendarListTransportObservation[],
  ): void;
  finish(testStatus: string | undefined): void;
}

export declare function createPrivateUiCheckpointJournal(options: {
  stageFile: string;
  sourceSha: string;
  profile: string;
}): PrivateUiCheckpointJournal;
