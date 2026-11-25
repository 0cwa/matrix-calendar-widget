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

import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import type { CalendarEventFormValues } from '../../calendar';

export function createAlarmHandlers(
  setValues: Dispatch<SetStateAction<CalendarEventFormValues | undefined>>,
) {
  const handleAlarmToggle = (change: ChangeEvent<HTMLInputElement>) => {
    setValues((current) =>
      current
        ? {
            ...current,
            alarmEnabled: change.target.checked,
            alarmChanged: true,
          }
        : current,
    );
  };

  const handleAlarmDurationChange =
    (field: keyof CalendarEventFormValues) =>
    (change: ChangeEvent<HTMLInputElement>) => {
      setValues((current) =>
        current
          ? {
              ...current,
              [field]: change.target.value,
              alarmChanged: true,
            }
          : current,
      );
    };

  const handleAlarmModeChange = (change: ChangeEvent<HTMLInputElement>) => {
    const alarmMode =
      change.target.value === 'absolute' ? 'absolute' : 'relative';
    setValues((current) =>
      current ? { ...current, alarmMode, alarmChanged: true } : current,
    );
  };

  return {
    handleAlarmToggle,
    handleAlarmDurationChange,
    handleAlarmModeChange,
  };
}
