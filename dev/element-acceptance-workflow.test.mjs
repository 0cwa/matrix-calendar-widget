import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(
  resolve(ROOT, '.github/workflows/element-acceptance.yml'),
  'utf8',
);
const runner = readFileSync(
  resolve(ROOT, '.github/actions/element-acceptance/action.yml'),
  'utf8',
);
const e2e = readFileSync(
  resolve(ROOT, 'e2e/src/elementCalendarAcceptance.spec.ts'),
  'utf8',
);

test('the existing required Element acceptance job keeps its context', () => {
  assert.match(workflow, /element-web-acceptance:\n\s+name: Element Web acceptance/u);
  assert.match(workflow, /uses: \.\/\.github\/actions\/element-acceptance/u);
  assert.match(workflow, /principal-mode: appservice/u);
});

test('the extracted runner requires explicit legacy appservice mode', () => {
  assert.match(runner, /principal-mode:[\s\S]*?required: true/u);
  assert.match(runner, /if \[\[ "\$PRINCIPAL_MODE" != appservice \]\]/u);
  assert.match(runner, /ROOM_CALENDAR_PRINCIPAL_MODE=appservice/u);
  assert.doesNotMatch(runner, /bot-account/u);
});

test('the shared runner preserves the Element, restart, restore, and cleanup gates', () => {
  for (const step of [
    'Measure the real Element Web ordinary 0-and-25-event profiles',
    'Run the real Element Web member and outsider journey',
    'Run the packaged Element Desktop shared-calendar journey',
    'Provision the synthetic reminder sender room membership',
    'Enable the PostgreSQL-backed reminder fixture',
    'Verify real UI reminder delivery',
    'Restart the gateway and verify reminder scheduling',
    'Restore paired Radicale and PostgreSQL stores',
    'Verify Element Web client interactions and preservation',
    'Stop and remove the isolated stack and private evidence',
  ]) {
    assert.ok(runner.includes(step), `missing acceptance step: ${step}`);
  }
  assert.match(runner, /--grep "Element Web measures the ordinary 0-and-25-event calendar profile"/u);
  assert.match(runner, /--grep "Element Web delivers a relative room reminder"/u);
  assert.match(runner, /--grep "Element Web preserves unsupported events and supports client interactions"/u);
  assert.match(runner, /if: always\(\)[\s\S]*?Stop and remove the isolated stack/u);
  assert.match(e2e, /toBeLessThanOrEqual\(2000\)/u);
  assert.match(e2e, /toBeLessThanOrEqual\(1000\)/u);
  assert.match(e2e, /toBeLessThanOrEqual\(500\)/u);
  assert.doesNotMatch(runner, /continue-on-error:\s*true/u);
});
