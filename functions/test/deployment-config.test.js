import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarJobDatesChanged, calendarReconcile } from '../index.js';

test('Firestore trigger stays in the existing Melbourne database region', () => {
  const endpoint = calendarJobDatesChanged.__endpoint;
  assert.deepEqual(endpoint.region, ['australia-southeast2']);
  assert.equal(endpoint.eventTrigger.eventType, 'google.cloud.firestore.document.v1.written');
  assert.equal(endpoint.serviceAccountEmail, 'crm-calendar-sync@rendermates-crm.iam.gserviceaccount.com');
});

test('scheduled function uses supported Sydney region with Wellington local timezone', () => {
  const endpoint = calendarReconcile.__endpoint;
  assert.deepEqual(endpoint.region, ['australia-southeast1']);
  assert.equal(endpoint.scheduleTrigger.schedule, 'every 5 minutes');
  assert.equal(endpoint.scheduleTrigger.timeZone, 'Pacific/Auckland');
  assert.equal(endpoint.serviceAccountEmail, 'crm-calendar-sync@rendermates-crm.iam.gserviceaccount.com');
});
