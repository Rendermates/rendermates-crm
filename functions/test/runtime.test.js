import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { getApp, getApps } from 'firebase-admin/app';
import { database } from '../runtime.js';

process.env.GOOGLE_CLOUD_PROJECT = 'calendar-runtime-test';
process.env.GCLOUD_PROJECT = 'calendar-runtime-test';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'calendar-runtime-test' });
const require = createRequire(import.meta.url);
const sdk = require('firebase-functions/v2/firestore');

test('real Firestore SDK decoding before the handler does not prevent default-app initialization', () => {
  assert.throws(() => getApp(), { code: 'app/no-app' });
  const name = 'projects/calendar-runtime-test/databases/(default)/documents/jobs/test';
  const value = {
    name, fields: { startDate: { stringValue: '2026-11-17' } },
    createTime: '2026-11-03T00:00:00Z', updateTime: '2026-11-03T00:00:00Z'
  };
  const event = sdk.makeChangedFirestoreEvent({
    project: 'calendar-runtime-test', database: '(default)', document: 'jobs/test',
    datacontenttype: 'application/json', data: { value, oldValue: value }
  }, { jobId: 'test' });
  assert.equal(event.data.after.data().startDate, '2026-11-17');
  assert.ok(getApps().some(app => app.name === '__FIREBASE_FUNCTIONS_SDK__'));
  assert.throws(() => getApp(), { code: 'app/no-app' });
  assert.ok(database());
  assert.equal(getApp().name, '[DEFAULT]');
});

test('warm runtime reuses the default app even when the SDK named app also exists', () => {
  const first = database();
  assert.equal(database(), first);
  assert.equal(getApps().filter(app => app.name === '[DEFAULT]').length, 1);
});
