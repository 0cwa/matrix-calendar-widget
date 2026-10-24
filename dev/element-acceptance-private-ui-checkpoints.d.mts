export type PrivateUiCheckpointPhase =
  | 'private-ui-fixture-ready'
  | 'private-ui-member-a-auth'
  | 'private-ui-member-a-room'
  | 'private-ui-member-a-widget-ready'
  | 'private-ui-dialog-open'
  | 'private-ui-initial-list'
  | 'private-ui-calendar-select'
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

export declare const PRIVATE_UI_CHECKPOINT_PHASES: readonly PrivateUiCheckpointPhase[];
export declare const PRIVATE_UI_RESULT_PHASE: 'private-ui-test-result';

export interface PrivateUiCheckpointJournal {
  run<T>(
    phase: PrivateUiCheckpointPhase,
    operation: () => Promise<T> | T,
  ): Promise<T>;
  finish(testStatus: string | undefined): void;
}

export declare function createPrivateUiCheckpointJournal(options: {
  stageFile: string;
  sourceSha: string;
  profile: string;
}): PrivateUiCheckpointJournal;
