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

/** Maximum number of external links projected for one calendar event. */
export const MAX_CALENDAR_EVENT_EXTERNAL_LINKS = 20;

/** Maximum Unicode code points in an untrusted calendar link label. */
export const MAX_CALENDAR_EVENT_EXTERNAL_LINK_LABEL_LENGTH = 120;

/** Maximum accepted URI length for an external calendar link. */
export const MAX_CALENDAR_EVENT_EXTERNAL_LINK_URI_LENGTH = 4096;

/**
 * Canonicalize an untrusted calendar URI for explicit user-click navigation.
 * Relative, credential-bearing, control-containing, and non-HTTP(S) values are
 * not navigation targets.
 */
export function canonicalizeCalendarExternalUrl(
  value: unknown,
): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_CALENDAR_EVENT_EXTERNAL_LINK_URI_LENGTH ||
    value.trim() !== value ||
    hasUnsafeControlOrBidiCharacter(value) ||
    value.includes('\\') ||
    !/^https?:\/\//iu.test(value)
  ) {
    return undefined;
  }

  const authority = getRawAuthority(value);
  if (!authority || authority.includes('@')) {
    return undefined;
  }

  let url: URL;
  try {
    // No base is passed: protocol-relative and other relative references fail.
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.href.length > MAX_CALENDAR_EVENT_EXTERNAL_LINK_URI_LENGTH ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return undefined;
  }

  return url.href;
}

/** Bound a plain-text iCalendar parameter before it is shown in the UI. */
export function boundCalendarEventExternalLinkLabel(
  value: unknown,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = Array.from(value)
    .filter((character) => !isUnsafeControlOrBidiCharacter(character))
    .join('')
    .trim();
  if (normalized.length === 0) {
    return undefined;
  }

  return Array.from(normalized)
    .slice(0, MAX_CALENDAR_EVENT_EXTERNAL_LINK_LABEL_LENGTH)
    .join('');
}

function hasUnsafeControlOrBidiCharacter(value: string): boolean {
  return Array.from(value).some(isUnsafeControlOrBidiCharacter);
}

function isUnsafeControlOrBidiCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) {
    return true;
  }

  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

function getRawAuthority(value: string): string | undefined {
  const authorityStart = value.indexOf('://');
  if (authorityStart < 0) {
    return undefined;
  }

  const authorityEnd = value.slice(authorityStart + 3).search(/[/?#]/u);
  const authority =
    authorityEnd < 0
      ? value.slice(authorityStart + 3)
      : value.slice(authorityStart + 3, authorityStart + 3 + authorityEnd);

  return authority;
}
