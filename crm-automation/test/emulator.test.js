import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { nzDay } from '../domain.js';
import { hash, suppressionId, unsubscribeToken } from '../mail.js';

// This file is invoked only by the demo-project emulator suite, never production.
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Local Firestore emulator required.');
const app = initializeApp({ projectId: 'demo-crm-automation' });
const db = getFirestore(app);
let handlers;
const secret = 'fictional-emulator-signing-key-not-a-real-credential';
const day = nzDay();
const job = {
  clientName: 'Example emulator customer', email: 'emulator@example.test', status: 'lead',
  createdAt: '2026-01-01T00:00:00Z', address: 'TEST ONLY',
  contractAmount: 1234, claims: [{ id: 'protected', amount: 200 }], extras: [{ amount: 100 }],
  calendarSync: { status: 'synced' }, contactPreferences: {
    marketing: { optIn: true, source: 'Fictional emulator-only consent', recordedBy: 'test', recordedAt: day }
  }
};
before(async () => {
  process.env.CRM_UNSUBSCRIBE_SECRET = secret;
  handlers = await import('../index.js');
});
beforeEach(async () => {
  for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
});
after(async () => { await db.terminate(); await deleteApp(app); });
const seed = async () => {
  await db.doc('jobs/emulator-job').set(job);
  await db.doc('crmEmailRules/annual').set({
    name: 'Fictional annual campaign', kind: 'marketing', trigger: 'annual',
    monthDay: day.slice(5), enabled: true, subject: 'Test', body: 'Fictional test only'
  });
};

test('scheduler dry-runs and deduplicates without mutating existing financial/calendar data', async () => {
  await seed();
  await handlers.crmQueueEmails.run({});
  await handlers.crmQueueEmails.run({});
  const rows = await db.collection('crmEmailOutbox').get();
  assert.equal(rows.size, 1); assert.equal(rows.docs[0].data().status, 'dry_run');
  assert.deepEqual((await db.doc('jobs/emulator-job').get()).data(), job);
  await db.doc('_crmAutomationControl/email').set({ enabled: true });
  await handlers.crmQueueEmails.run({});
  assert.equal((await db.collection('crmEmailOutbox').get()).docs[0].data().status, 'dry_run');
});
test('disabled dispatch exits without sender secrets or outbound provider requests', async () => {
  await db.doc('crmEmailOutbox/fake').set({ status: 'pending' });
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected provider request'); };
  try { await handlers.crmSendEmails.run({}); } finally { globalThis.fetch = original; }
  assert.equal(calls, 0);
  assert.equal((await db.doc('crmEmailOutbox/fake').get()).data().status, 'pending');
});
test('customer event retries capture message/status once and preserve money and sync metadata', async () => {
  const ref = db.doc('jobs/emulator-job');
  await ref.set(job);
  const before = await ref.get();
  await ref.update({ status: 'booked', message: 'A fictional incoming enquiry.' });
  const after = await ref.get();
  const event = { id: 'emulator-event', time: '2026-11-11T01:00:00Z', data: { before, after }, params: { jobId: 'emulator-job' } };
  await handlers.crmCustomerEvents.run(event);
  await handlers.crmCustomerEvents.run(event);
  assert.equal((await ref.collection('messages').get()).size, 1);
  assert.equal((await ref.collection('activity').get()).size, 1);
  const saved = (await ref.get()).data();
  assert.equal(saved.closedWonAt, event.time);
  for (const key of ['contractAmount', 'claims', 'extras', 'calendarSync']) assert.deepEqual(saved[key], job[key]);
});
test('unsubscribe GET is non-mutating and POST suppresses the category without exposing CRM data', async () => {
  await seed();
  const token = unsubscribeToken({ jobId: 'emulator-job', kind: 'marketing', emailHash: hash(job.email), expires: Date.now() + 10000 }, secret);
  const server = createServer(async (req, res) => {
    req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
    let body = '';
    for await (const chunk of req) body += chunk;
    req.body = Object.fromEntries(new URLSearchParams(body));
    res.set = (name, value) => { res.setHeader(name, value); return res; };
    res.status = code => { res.statusCode = code; return res; };
    res.type = type => { res.setHeader('Content-Type', type === 'html' ? 'text/html' : type); return res; };
    res.send = content => { res.end(content); return res; };
    await handlers.crmUnsubscribe(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const preview = await fetch(`${url}/?token=${encodeURIComponent(token)}`);
    assert.equal(preview.status, 200);
    assert.equal((await db.doc('jobs/emulator-job').get()).data().contactPreferences.marketing.optIn, true);
    assert.equal((await db.doc(`_crmEmailSuppressions/${suppressionId(job.email, 'marketing')}`).get()).exists, false);
    const result = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
    assert.equal(result.status, 200);
    assert.equal((await db.doc('jobs/emulator-job').get()).data().contactPreferences.marketing.optIn, false);
    assert.equal((await db.doc(`_crmEmailSuppressions/${suppressionId(job.email, 'marketing')}`).get()).exists, true);
    assert.equal((await fetch(`${url}/?token=invalid`)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
