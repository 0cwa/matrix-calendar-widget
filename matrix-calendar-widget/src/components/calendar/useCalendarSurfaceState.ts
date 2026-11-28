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

import { DateTime } from 'luxon';
import { useCallback, useMemo, useState } from 'react';
import { CalendarFilters } from '../../calendar';
import { generateFilterRange } from '../../lib/utils';
import {
  CalendarSurfaceView,
  isNarrowCalendarView,
  useIsWideCalendar,
} from './CalendarNavigation';

const viewTypes: readonly CalendarSurfaceView[] = [
  'list',
  'day',
  'workWeek',
  'week',
  'month',
];

type SurfaceState = {
  /** The view the user chose. Only explicit choices change and save it. */
  view: CalendarSurfaceView;
  /** The date range of the chosen view. */
  filters: CalendarFilters;
  /**
   * The day to show while a narrow widget stands in for a wide view, if it is
   * not simply derived from the range.
   */
  selectedDay?: string;
};

/**
 * Owns the chosen view and date range. A narrow widget shows a single day in
 * place of work week, week or month without replacing the user's choice, so
 * the wide view returns on the same dates once there is room again.
 */
export function useCalendarSurfaceState(viewStorageKey: string) {
  const isWide = useIsWideCalendar();
  const [state, setState] = useState<SurfaceState>(() =>
    initialState(readLastCalendarSurfaceView(viewStorageKey) ?? 'list'),
  );
  const showsDayInstead = !isWide && !isNarrowCalendarView(state.view);
  const view: CalendarSurfaceView = showsDayInstead ? 'day' : state.view;
  const filters = useMemo(
    () =>
      showsDayInstead
        ? { ...state.filters, ...dayInPlaceOfRange(state) }
        : state.filters,
    [showsDayInstead, state],
  );

  const setView = useCallback(
    (newView: CalendarSurfaceView) => {
      saveLastCalendarSurfaceView(viewStorageKey, newView);
      setState({
        view: newView,
        filters:
          newView === 'list'
            ? filters
            : {
                ...filters,
                ...generateFilterRange(
                  newView,
                  filters.startDate,
                  view !== 'list' ? view : undefined,
                ),
              },
        selectedDay: view === 'day' ? filters.startDate : undefined,
      });
    },
    [filters, view, viewStorageKey],
  );

  const setRange = useCallback(
    (startDate: string, endDate: string) =>
      setState((current) =>
        showsDayInstead && !isNarrowCalendarView(current.view)
          ? {
              ...current,
              filters: {
                ...current.filters,
                ...generateFilterRange(current.view, startDate),
              },
              selectedDay: startDate,
            }
          : {
              ...current,
              filters: { ...current.filters, startDate, endDate },
              selectedDay: undefined,
            },
      ),
    [showsDayInstead],
  );

  const setSearch = useCallback(
    (filterText: string) =>
      setState((current) => ({
        ...current,
        filters: { ...current.filters, filterText },
      })),
    [],
  );

  const showDay = useCallback(
    (date: Date) => {
      saveLastCalendarSurfaceView(viewStorageKey, 'day');
      setState((current) => ({
        view: 'day',
        filters: {
          ...current.filters,
          ...generateFilterRange('day', date.toISOString()),
        },
      }));
    },
    [viewStorageKey],
  );

  return { view, filters, setView, setRange, setSearch, showDay };
}

function initialState(view: CalendarSurfaceView): SurfaceState {
  const now = DateTime.now();

  if (view === 'list') {
    return {
      view,
      filters: {
        startDate: now.startOf('day').toISO(),
        endDate: now.plus({ days: 6 }).endOf('day').toISO(),
        filterText: '',
      },
    };
  }

  return {
    view,
    filters: { ...generateFilterRange(view, now.toISO()), filterText: '' },
    selectedDay: now.toISO(),
  };
}

/** The selected day, else today if the range includes it, else its first day. */
function dayInPlaceOfRange({ filters, selectedDay }: SurfaceState) {
  const now = DateTime.now();
  const rangeIncludesToday =
    DateTime.fromISO(filters.startDate) <= now &&
    now <= DateTime.fromISO(filters.endDate);

  return generateFilterRange(
    'day',
    selectedDay ?? (rangeIncludesToday ? now.toISO() : filters.startDate),
  );
}

function readLastCalendarSurfaceView(
  storageKey: string,
): CalendarSurfaceView | undefined {
  try {
    const storedView = window.localStorage.getItem(storageKey);
    return storedView && isCalendarSurfaceView(storedView)
      ? storedView
      : undefined;
  } catch {
    return undefined;
  }
}

function saveLastCalendarSurfaceView(
  storageKey: string,
  view: CalendarSurfaceView,
): void {
  try {
    window.localStorage.setItem(storageKey, view);
  } catch {
    // The current view remains usable when browser storage is unavailable.
  }
}

function isCalendarSurfaceView(value: string): value is CalendarSurfaceView {
  return viewTypes.includes(value as CalendarSurfaceView);
}
