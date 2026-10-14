import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
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

test('manual acceptance profile selection defaults to both and preserves PR jobs', () => {
  const dispatch = workflow.slice(
    workflow.indexOf('  workflow_dispatch:'),
    workflow.indexOf('  pull_request:'),
  );
  assert.match(
    dispatch,
    /principal_profile:[\s\S]*?type: choice[\s\S]*?options:[\s\S]*?- both[\s\S]*?- appservice[\s\S]*?- bot-account[\s\S]*?default: both[\s\S]*?required: true/u,
  );

  const appserviceJob = workflow.split('  element-web-acceptance:\n')[1];
  const botJob = workflow.split('  normal-bot-account-acceptance:\n')[1];
  assert.match(
    appserviceJob,
    /if: \$\{\{ github\.event_name != 'workflow_dispatch' \|\| inputs\.principal_profile == 'both' \|\| inputs\.principal_profile == 'appservice' \}\}/u,
  );
  assert.match(
    botJob,
    /if: \$\{\{ github\.event_name != 'workflow_dispatch' \|\| inputs\.principal_profile == 'both' \|\| inputs\.principal_profile == 'bot-account' \}\}/u,
  );
});

test('the failed bot Desktop job retains only the safe limiter diagnostic lines', () => {
  const capture = runner.slice(
    runner.indexOf(
      '    - name: Show safe normal-bot gateway rate-limit diagnostics',
    ),
    runner.indexOf(
      '    - name: Provision the synthetic reminder sender room membership',
    ),
  );
  assert.match(
    capture,
    /if: \$\{\{ always\(\) && inputs\.principal-mode == 'bot-account' && steps\.desktop_journey\.outcome != 'skipped' \}\}/u,
  );
  assert.match(
    capture,
    /docker compose[\s\S]*?logs --no-color gateway \| rg 'calendar_gateway_rate_limit_denied' \|\| true/u,
  );
  assert.ok(
    runner.indexOf(
      '    - name: Show safe normal-bot gateway rate-limit diagnostics',
    ) <
      runner.indexOf(
        '    - name: Provision the synthetic reminder sender room membership',
      ),
    'the diagnostic capture runs before later fixture work can affect the log',
  );
});

test('the existing required Element acceptance job keeps its context', () => {
  assert.match(
    workflow,
    /element-web-acceptance:\n\s+name: Element Web acceptance/u,
  );
  assert.match(workflow, /uses: \.\/\.github\/actions\/element-acceptance/u);
  assert.match(workflow, /principal-mode: appservice/u);
});

test('both fixture jobs select one strict process-wide principal mode', () => {
  assert.match(runner, /principal-mode:[\s\S]*?required: true/u);
  assert.match(
    runner,
    /case "\$PRINCIPAL_MODE" in[\s\S]*?appservice\)[\s\S]*?bot-account\)[\s\S]*?\*\)/u,
  );
  assert.match(runner, /ROOM_CALENDAR_PRINCIPAL_MODE=\$PRINCIPAL_MODE/u);
  assert.match(runner, /node --test dev\/element-acceptance-setup\.test\.mjs/u);
  assert.match(
    runner,
    /node --test dev\/element-acceptance-caldav-report-probe\.test\.mjs/u,
  );
  assert.ok(
    runner.indexOf('yarn workspace @matrix-calendar-widget/server build') <
      runner.indexOf(
        'node --test dev/element-acceptance-caldav-report-probe.test.mjs',
      ),
    'the report-probe guard test runs after its built server imports exist',
  );
  assert.match(
    workflow,
    /element-web-acceptance:\n\s+name: Element Web acceptance/u,
  );
  assert.match(
    workflow,
    /normal-bot-account-acceptance:\n\s+name: Normal bot account acceptance/u,
  );
  assert.match(workflow, /principal-mode: appservice/u);
  assert.match(workflow, /principal-mode: bot-account/u);

  const botJob = workflow.split('  normal-bot-account-acceptance:\n')[1];
  assert.ok(botJob, 'missing normal bot account job');
  assert.match(
    botJob,
    /MATRIX_CALENDAR_DEV_APPSERVICE_REGISTRATION: disabled/u,
  );
  assert.doesNotMatch(botJob, /MATRIX_APPLICATION_SERVICE_TOKEN:/u);
  assert.match(
    runner,
    /bot-account\)[\s\S]*?\[\[ "\$\{MATRIX_APPLICATION_SERVICE_TOKEN\+x\}" == x \|\| "\$\{MATRIX_CALENDAR_DEV_APPSERVICE_REGISTRATION:-\}" != disabled \]\]/u,
  );
  assert.match(runner, /MATRIX_APPLICATION_SERVICE_USER_ID=/u);
  assert.match(
    runner,
    /bot-account\)[\s\S]*?ELEMENT_ACCEPTANCE_RATE_LIMIT_DIAGNOSTICS=true/u,
  );
  assert.match(
    runner,
    /PRINCIPAL_MODE" == appservice[\s\S]*?ELEMENT_ACCEPTANCE_RATE_LIMIT_DIAGNOSTICS=false/u,
  );
  assert.match(
    runner,
    /Show safe normal-bot gateway rate-limit diagnostics[\s\S]*?inputs\.principal-mode == 'bot-account'[\s\S]*?rg 'calendar_gateway_rate_limit_denied'/u,
  );
  assert.match(e2e, /sender\.accessToken !== bot\.accessToken/u);
  assert.match(e2e, /openIdBody = JSON\.stringify\(\{\}\)/u);
  assert.match(
    e2e,
    /process\.env\.MATRIX_APPLICATION_SERVICE_TOKEN !== undefined/u,
  );
  assert.match(e2e, /principal\.openIdBody === undefined/u);
  assert.match(e2e, /fixtureValue\.users\.bot/u);
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
  assert.match(
    runner,
    /--grep "Element Web measures the ordinary 0-and-25-event calendar profile"/u,
  );
  assert.match(
    runner,
    /--grep "Element Web delivers a relative room reminder"/u,
  );
  assert.match(
    runner,
    /--grep "Element Web preserves unsupported events and supports client interactions"/u,
  );
  assert.match(
    runner,
    /if: always\(\)[\s\S]*?Stop and remove the isolated stack/u,
  );
  assert.match(e2e, /toBeLessThanOrEqual\(2000\)/u);
  assert.match(e2e, /toBeLessThanOrEqual\(1000\)/u);
  assert.match(e2e, /toBeLessThanOrEqual\(500\)/u);
  assert.doesNotMatch(runner, /continue-on-error:\s*true/u);
});
