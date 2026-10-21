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

/** Return true for raw or encoded root paths in the private-client namespace. */
export function isPrivateCalendarClientDavPath(path: string): boolean {
  const rawPath = path.split(/[?#]/u, 1)[0] ?? '';
  try {
    return decodeURIComponent(rawPath).startsWith('/mcwpc~');
  } catch {
    return rawPath.startsWith('/mcwpc~');
  }
}
