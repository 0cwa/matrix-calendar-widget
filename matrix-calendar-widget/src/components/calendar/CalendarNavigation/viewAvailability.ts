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

import { useMediaQuery } from '@mui/material';
import type { CalendarSurfaceView } from './CalendarNavigation';

const narrowViews: readonly CalendarSurfaceView[] = ['list', 'day'];
export const WIDE_CALENDAR_MIN_WIDTH_PX = 800;

/** Whether the widget is wide enough for work week, week and month. */
export function useIsWideCalendar(): boolean {
  return useMediaQuery(`(min-width:${WIDE_CALENDAR_MIN_WIDTH_PX}px)`, {
    noSsr: true,
  });
}

/** Whether a view can be shown in a narrow widget. */
export function isNarrowCalendarView(
  view: CalendarSurfaceView,
): view is 'list' | 'day' {
  return narrowViews.includes(view);
}
