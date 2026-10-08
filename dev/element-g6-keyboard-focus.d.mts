export type G6KeyboardFocusTarget =
  | 'edit'
  | 'delete'
  | 'close'
  | 'dialog-content'
  | 'other'
  | 'outside'
  | 'unavailable';

export type G6KeyboardFocusClassificationInput = {
  frameHasFocus: boolean;
  activeElementAvailable: boolean;
  editFocused: boolean | undefined;
  deleteFocused: boolean | undefined;
  closeFocused: boolean | undefined;
  dialogContentFocused: boolean | undefined;
  ambiguousTarget: boolean;
};

export function classifyG6KeyboardFocusTarget(
  input: G6KeyboardFocusClassificationInput,
): G6KeyboardFocusTarget;
