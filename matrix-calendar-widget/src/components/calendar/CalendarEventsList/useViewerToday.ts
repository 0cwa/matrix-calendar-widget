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
import { useEffect, useState } from 'react';

/**
 * The viewer's current calendar date. A widget can stay open past midnight, and
 * timers can be delayed while a device sleeps, so the date is also read again
 * when the widget becomes visible.
 */
export function useViewerToday(): string {
  const [today, setToday] = useState(currentDate);

  useEffect(() => {
    let timeout: number;
    const refresh = () => {
      window.clearTimeout(timeout);
      setToday(currentDate());
      const now = DateTime.local();
      timeout = window.setTimeout(
        refresh,
        now.plus({ days: 1 }).startOf('day').diff(now).toMillis(),
      );
    };

    refresh();
    document.addEventListener('visibilitychange', refresh);

    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return today;
}

function currentDate(): string {
  return DateTime.local().toISODate() as string;
}
