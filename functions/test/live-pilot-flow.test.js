import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const realRequire = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../live-pilot.cjs', import.meta.url), 'utf8')
  .replace("await import('./runtime.js')", 'await globalThis.mockRuntime()') +
  '\nmodule.exports.main = main;';
const id = 'crm-sync-pilot-20261103';
const calendar = 'b8bd496115a7f8f2f35909f0726505d46bc9410c26e1a4e7a47061fff1921ac3@group.calendar.google.com';

async function scenario(mode) {
  let text = `CALENDAR_SYNC_ENABLED=false\nCALENDAR_SYNC_JOB_IDS=\nGOOGLE_CALENDAR_ID=${calendar}\nGOOGLE_CALENDAR_WRITER=crm-calendar-writer@rendermates-crm.iam.gserviceaccount.com\n`;
  let enabled = 'false', allowed = '', deployments = 0, clock = 0, terminated = false;
  const documents = new Map([
    ['jobs/real-customer', { clientName: 'private fixture', contractAmount: 900, startDate: '2026-11-01', endDate: '2026-11-02' }],
    ['_calendarSyncControl/main', { initialized: true, calendarId: calendar }]
  ]);
  if (mode === 'collision') documents.set(`jobs/${id}`, { contractAmount: 800 });
  const read = key => ({ exists: documents.has(key), data: () => structuredClone(documents.get(key)) });
  const ref = key => ({
    get: async () => read(key),
    create: async value => { assert.equal(documents.has(key), false); documents.set(key, structuredClone(value)); },
    update: async value => {
      documents.set(key, { ...documents.get(key), ...structuredClone(value) });
      if (key === `jobs/${id}` && enabled === 'true') {
        documents.set(`_calendarSyncState/${id}`, { base: structuredClone(value), status: 'synced' });
      }
    },
    delete: async () => { documents.delete(key); }
  });
  const db = {
    collection: name => ({
      doc: doc => ref(`${name}/${doc}`),
      get: async () => ({ docs: [...documents].filter(([key]) => key.startsWith(`${name}/`))
        .map(([key, value]) => ({ id: key.slice(name.length + 1), data: () => structuredClone(value) })) })
    }),
    terminate: async () => { terminated = true; }
  };
  const process = { argv: ['node', 'test'], env: {}, chdir() {}, once() {}, removeListener() {} };
  const child = {
    spawnSync(command, args) {
      if (command === 'npx') {
        deployments++;
        if (mode === 'shutdown_failure' && deployments === 2) return { status: 1 };
        enabled = text.match(/^CALENDAR_SYNC_ENABLED=(.*)$/m)[1];
        allowed = text.match(/^CALENDAR_SYNC_JOB_IDS=(.*)$/m)[1];
      } else if (args[0] === 'functions') {
        return { status: 0, stdout: JSON.stringify({ state: 'ACTIVE', serviceConfig: { environmentVariables: {
          CALENDAR_SYNC_ENABLED: enabled, CALENDAR_SYNC_JOB_IDS: allowed
        } } }) };
      } else if (args[0] === 'scheduler' && mode !== 'incoming_timeout') {
        const dates = { startDate: '2026-11-23', endDate: '2026-11-24' };
        documents.set(`jobs/${id}`, { ...documents.get(`jobs/${id}`), ...dates });
        documents.set(`_calendarSyncState/${id}`, { base: dates, status: 'synced' });
      }
      return { status: 0, stdout: '' };
    }
  };
  const module = { exports: {} };
  const require = name => {
    if (name === 'node:fs') return { readFileSync: () => text, writeFileSync: (_file, value) => { text = value; } };
    if (name === 'node:child_process') return child;
    return realRequire(name);
  };
  require.main = {};
  vm.runInNewContext(source, {
    require, module, __dirname: '/test/functions', __filename: '/test/functions/live-pilot.cjs',
    process, console: { log() {}, error() {} }, structuredClone,
    Date: class extends Date { static now() { clock += 1000; return clock; } },
    setTimeout: callback => { clock += 5000; callback(); },
    mockRuntime: async () => ({ database: () => db })
  });
  await module.exports.main();
  assert.equal(documents.get('jobs/real-customer').contractAmount, 900);
  assert.equal(terminated, true);
  return { documents, text, enabled, allowed, deployments, process };
}
test('live pilot restores remote disabled flags and removes only its own fixture after success', async () => {
  const result = await scenario('success');
  assert.equal(result.enabled, 'false');
  assert.equal(result.allowed, '');
  assert.equal(result.deployments, 2);
  assert.equal(result.documents.has(`jobs/${id}`), false);
  assert.equal(result.documents.has(`_calendarSyncState/${id}`), false);
  assert.notEqual(result.process.exitCode, 1);
});
test('incoming timeout still restores disabled flags and cleans only its own fixture', async () => {
  const result = await scenario('incoming_timeout');
  assert.equal(result.enabled, 'false');
  assert.equal(result.documents.has(`jobs/${id}`), false);
  assert.equal(result.process.exitCode, 1);
});
test('failed remote shutdown retains the fixture and reports failure instead of claiming disabled', async () => {
  const result = await scenario('shutdown_failure');
  assert.equal(result.enabled, 'true');
  assert.equal(result.allowed, id);
  assert.equal(result.documents.has(`jobs/${id}`), true);
  assert.equal(result.process.exitCode, 1);
  assert.match(result.text, /^CALENDAR_SYNC_ENABLED=false$/m);
});
test('an existing record with the pilot ID is never overwritten, deleted, or activated', async () => {
  const result = await scenario('collision');
  assert.equal(result.documents.get(`jobs/${id}`).contractAmount, 800);
  assert.equal(result.deployments, 0);
  assert.equal(result.process.exitCode, 1);
});
