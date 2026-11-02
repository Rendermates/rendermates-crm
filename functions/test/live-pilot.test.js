import test from 'node:test';
import assert from 'node:assert/strict';
import pilot from '../live-pilot.cjs';

const config = 'CALENDAR_SYNC_ENABLED=false\nCALENDAR_SYNC_JOB_IDS=\nOTHER_CONFIGURATION=keep\n';
test('pilot configuration enables only an exact fictitious ID and preserves other configuration', () => {
  const next = pilot.scopedConfig(config, true, 'crm-sync-pilot-20261103');
  assert.equal(pilot.setting(next, 'CALENDAR_SYNC_ENABLED'), 'true');
  assert.equal(pilot.setting(next, 'CALENDAR_SYNC_JOB_IDS'), 'crm-sync-pilot-20261103');
  assert.match(next, /^OTHER_CONFIGURATION=keep$/m);
  assert.equal(pilot.scopedConfig(next, false, ''), config);
});
test('pilot refuses ambiguous or missing configuration', () => {
  assert.throws(() => pilot.setting(config + 'CALENDAR_SYNC_ENABLED=true\n', 'CALENDAR_SYNC_ENABLED'));
  assert.throws(() => pilot.setting(config, 'MISSING'));
});
test('unchanged-data hashes are independent of field order but detect financial changes', () => {
  assert.equal(pilot.digest({ a: 1, nested: { b: 2, a: 3 } }), pilot.digest({ nested: { a: 3, b: 2 }, a: 1 }));
  assert.notEqual(pilot.digest({ contractAmount: 100 }), pilot.digest({ contractAmount: 101 }));
});
test('pilot comparison retains claims, extras, contacts and business status', () => {
  const business = { claims: [{ amount: 100 }], extras: [12], clientEmail: '', status: 'Scheduled' };
  assert.deepEqual(pilot.businessData({ ...business, startDate: '2026-11-17', endDate: '2026-11-18', calendarSync: {} }), business);
});
test('pilot requires both inclusive CRM date boundaries', () => {
  const dates = { startDate: '2026-11-17', endDate: '2026-11-18' };
  assert.equal(pilot.matches(dates, dates), true);
  assert.equal(pilot.matches({ ...dates, endDate: '2026-11-19' }, dates), false);
  assert.equal(pilot.matches(undefined, dates), false);
});
