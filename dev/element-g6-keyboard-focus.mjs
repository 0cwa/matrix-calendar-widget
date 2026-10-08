/* Modified for Matrix Calendar Widget fork, 2026. */
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

export function classifyG6KeyboardFocusTarget({
  frameHasFocus,
  activeElementAvailable,
  editFocused,
  deleteFocused,
  closeFocused,
  dialogContentFocused,
  ambiguousTarget,
}) {
  if (frameHasFocus === false) return 'outside';
  if (frameHasFocus !== true || activeElementAvailable !== true) {
    return 'unavailable';
  }

  const matches = [
    ['edit', editFocused],
    ['delete', deleteFocused],
    ['close', closeFocused],
    ['dialog-content', dialogContentFocused],
  ].filter(([, focused]) => focused === true);
  if (matches.length === 1) return matches[0][0];
  if (
    matches.length > 1 ||
    ambiguousTarget ||
    [editFocused, deleteFocused, closeFocused, dialogContentFocused].some(
      (focused) => focused === undefined,
    )
  ) {
    return 'unavailable';
  }
  return 'other';
}
