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

import { CalendarRepository } from '@matrix-calendar-widget/calendar';
import {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

type CalendarRepositoryContextValue = {
  repository: CalendarRepository;
  revision: number;
  invalidate: () => void;
};

const CalendarRepositoryContext = createContext<
  CalendarRepositoryContextValue | undefined
>(undefined);

export function CalendarRepositoryProvider({
  children,
  repository,
}: PropsWithChildren<{ repository: CalendarRepository }>) {
  const [revision, setRevision] = useState(0);
  const invalidate = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);
  const value = useMemo(
    () => ({ repository, revision, invalidate }),
    [invalidate, repository, revision],
  );

  return (
    <CalendarRepositoryContext.Provider value={value}>
      {children}
    </CalendarRepositoryContext.Provider>
  );
}

function useCalendarRepositoryContext(): CalendarRepositoryContextValue {
  const value = useContext(CalendarRepositoryContext);

  if (!value) {
    throw new Error(
      'useCalendarRepository must be used inside CalendarRepositoryProvider',
    );
  }

  return value;
}

export function useCalendarRepository(): CalendarRepository {
  return useCalendarRepositoryContext().repository;
}

export function useCalendarRepositoryRevision(): number {
  return useCalendarRepositoryContext().revision;
}

export function useInvalidateCalendarRepository(): () => void {
  return useCalendarRepositoryContext().invalidate;
}
