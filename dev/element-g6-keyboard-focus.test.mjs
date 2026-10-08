import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyG6KeyboardFocusTarget } from './element-g6-keyboard-focus.mjs';

const frameHasFocus = {
  frameHasFocus: true,
  activeElementAvailable: true,
  editFocused: false,
  deleteFocused: false,
  closeFocused: false,
  dialogContentFocused: false,
  ambiguousTarget: false,
};

test('a blurred frame is outside even when its stale active element matches Edit', () => {
  assert.equal(
    classifyG6KeyboardFocusTarget({
      ...frameHasFocus,
      frameHasFocus: false,
      editFocused: true,
    }),
    'outside',
  );
});

test('a failed or detached focus probe is unavailable instead of other', () => {
  assert.equal(
    classifyG6KeyboardFocusTarget({
      ...frameHasFocus,
      editFocused: undefined,
    }),
    'unavailable',
  );
});

test('a focused frame with known non-action focus is other', () => {
  assert.equal(classifyG6KeyboardFocusTarget(frameHasFocus), 'other');
});
