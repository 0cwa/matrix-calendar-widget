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

import {
  contentLineParameters,
  foldContentLine,
  parseContentLine,
  readContentLines,
  splitContentLineHeader,
} from './ICalendarContentLine';

describe('iCalendar content lines', () => {
  it('unfolds continuation lines while retaining the original physical lines', () => {
    expect(
      readContentLines('SUMMARY:some long\r\n  text\r\nEND:VEVENT\r\n'),
    ).toEqual([
      {
        value: 'SUMMARY:some long text',
        physicalLines: ['SUMMARY:some long', '  text'],
      },
      { value: 'END:VEVENT', physicalLines: ['END:VEVENT'] },
    ]);
  });

  it('parses colons and semicolons inside quoted header parameters', () => {
    const line =
      'ATTACH;ALTREP="https://example.test/a:b";X-LABEL="one;two":https://example.test/file';

    expect(parseContentLine(line)).toEqual({
      name: 'attach',
      header: 'ATTACH;ALTREP="https://example.test/a:b";X-LABEL="one;two"',
      value: 'https://example.test/file',
    });
    expect(contentLineParameters(parseContentLine(line)!.header)).toEqual([
      { name: 'altrep', value: 'https://example.test/a:b' },
      { name: 'x-label', value: 'one;two' },
    ]);
    expect(splitContentLineHeader('ATTACH;ALTREP="a;b";VALUE=URI')).toEqual([
      'ATTACH',
      'ALTREP="a;b"',
      'VALUE=URI',
    ]);
  });

  it('folds by UTF-8 octets and unfolds back to the same logical line', () => {
    const value = `SUMMARY:${'a'.repeat(65)}💩${'z'.repeat(80)}`;
    const folded = foldContentLine(value);

    expect(folded.value).toBe(value);
    expect(
      folded.physicalLines.every((line) => Buffer.byteLength(line) <= 75),
    ).toBe(true);
    expect(
      folded.physicalLines.slice(1).every((line) => line.startsWith(' ')),
    ).toBe(true);
    expect(readContentLines(folded.physicalLines.join('\r\n'))[0].value).toBe(
      value,
    );
  });

  it('returns no parsed property for malformed lines', () => {
    expect(parseContentLine('not-a-content-line')).toBeUndefined();
    expect(parseContentLine(':missing-name')).toBeUndefined();
  });
});
