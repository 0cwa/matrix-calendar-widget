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

import { Calendar, CalendarId } from '@matrix-calendar-widget/calendar';
import { Box } from '@mui/material';

/** How an event surface identifies the calendar that an event belongs to. */
export type EventCalendarIdentity = {
  /** The calendar name, which is the cue that does not depend on color. */
  name: string;
  /** The configured calendar color, when it is a usable hex value. */
  color?: string;
};

/**
 * Events only need to name their calendar when there is a color to explain or
 * more than one calendar to tell apart.
 */
export function eventCalendarIdentities(
  calendars: Calendar[],
): Map<CalendarId, EventCalendarIdentity> {
  const identities = new Map<CalendarId, EventCalendarIdentity>();

  for (const calendar of calendars) {
    const color = opaqueHexColor(calendar.color);
    if (color || calendars.length > 1) {
      identities.set(calendar.id, { name: calendar.name, color });
    }
  }

  return identities;
}

// CalDAV servers can report #RRGGBBAA. Drop the alpha channel so that the small
// accent can't disappear.
function opaqueHexColor(color: string | undefined): string | undefined {
  return color && /^#[\da-f]{6}([\da-f]{2})?$/i.test(color)
    ? color.slice(0, 7)
    : undefined;
}

/**
 * Decorative color dot. The ring keeps any configured color, including one that
 * matches the surface, distinguishable from its background.
 */
export function CalendarColorDot({
  color,
  ringColor,
}: {
  color: string;
  ringColor: string;
}) {
  return (
    <Box
      aria-hidden
      component="span"
      data-testid="calendar-color-dot"
      sx={{
        backgroundColor: color,
        borderRadius: '50%',
        boxShadow: `0 0 0 1px ${ringColor}`,
        display: 'inline-block',
        flexShrink: 0,
        height: 8,
        width: 8,
      }}
    />
  );
}
