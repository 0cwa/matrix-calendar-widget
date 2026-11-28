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

import { listCalendarTimezones } from '@matrix-calendar-widget/calendar';
import { Autocomplete, TextField } from '@mui/material';
import { useRef } from 'react';

const timezones = listCalendarTimezones();
const listedTimezones = new Set(timezones);

export function IanaTimezoneAutocomplete({
  label,
  value,
  onChange,
  error,
  helperText,
  required,
  popperContainer,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
  helperText?: string;
  required?: boolean;
  popperContainer?: () => HTMLElement | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <Autocomplete
      autoHighlight
      disableClearable
      filterOptions={filterTimezones}
      forcePopupIcon
      freeSolo
      fullWidth
      inputValue={value}
      onChange={(_, selected) => onChange(selected)}
      onInputChange={(_, input, reason) => {
        if (reason === 'input') onChange(input);
      }}
      options={timezones}
      ref={rootRef}
      slotProps={{
        popper: {
          container: () =>
            popperContainer?.() ??
            rootRef.current?.closest('.MuiDialog-root') ??
            document.body,
        },
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          error={error}
          helperText={helperText}
          label={label}
          required={required}
        />
      )}
      value={listedTimezones.has(value) ? value : ''}
    />
  );
}

/** Match every typed word, so "new york" finds America/New_York. */
function filterTimezones(
  options: string[],
  { inputValue }: { inputValue: string },
): string[] {
  const query = searchableTimezone(inputValue);
  if (!query) {
    return options;
  }

  const words = query.split(' ');
  const matches = options.filter((option) => {
    const candidate = searchableTimezone(option);
    return words.every((word) => candidate.includes(word));
  });
  // An exact identifier leads, so Enter never swaps it for a longer alias.
  return matches.sort(
    (left, right) =>
      Number(searchableTimezone(right) === query) -
      Number(searchableTimezone(left) === query),
  );
}

function searchableTimezone(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/\s]+/g, ' ')
    .trim();
}
