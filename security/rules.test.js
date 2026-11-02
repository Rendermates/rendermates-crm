import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

let env;
const emails = JSON.parse(await readFile(new URL('./authorized-users.json', import.meta.url), 'utf8'));
const [owner, staff] = emails;
const google = email => ({
  email, email_verified: true, firebase: { sign_in_provider: 'google.com' }
});
const client = (email = owner, claims = {}) => env.authenticatedContext(
  `uid-${email}`, { ...google(email), ...claims }
).firestore();
const job = db => doc(db, 'jobs', 'fictional-job');
const ruleSource = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rendermates-crm',
    firestore: { host: '127.0.0.1', port: 8088, rules: ruleSource }
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const email of emails) await setDoc(doc(db, '_crmAccess', email), { enabled: true });
    await setDoc(job(db), {
      clientName: 'FICTIONAL security test', status: 'booked',
      startDate: '2026-11-10', endDate: '2026-11-12',
      extras: [{ description: 'Test extra', amount: 50 }],
      claims: [{ description: 'Deposit', amount: 100, status: 'Paid' }],
      calendarSync: { status: 'synced' }
    });
    await setDoc(doc(db, '_calendarSyncState', 'fictional-job'), { baseline: 'private' });
    await setDoc(doc(db, '_calendarSyncControl', 'main'), { initialized: false });
  });
});

test('rules and provisioning agree on the explicitly authorized identities', () => {
  const emailLiterals = [...ruleSource.matchAll(/'([^']+@[^']+)'/g)].map(match => match[1]);
  assert.deepEqual(emailLiterals.sort(), [...emails].sort());
});

test('anonymous browsers cannot read, list, create, change or delete jobs', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(job(db)));
  await assertFails(getDocs(collection(db, 'jobs')));
  await assertFails(setDoc(doc(db, 'jobs', 'attack'), { clientName: 'Denied' }));
  await assertFails(updateDoc(job(db), { status: 'completed' }));
  await assertFails(deleteDoc(job(db)));
});

test('Google sign-in alone is insufficient, including an injected approval document', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(
    doc(context.firestore(), '_crmAccess', 'outsider@example.test'), { enabled: true }
  ));
  const db = client('outsider@example.test');
  await assertFails(getDocs(collection(db, 'jobs')));
  await assertFails(updateDoc(job(db), { startDate: '2026-11-20' }));
  await assertFails(getDoc(doc(db, '_crmAccess', 'outsider@example.test')));
});

test('unverified email, password provider and anonymous provider cannot use approved records', async () => {
  for (const claims of [
    { email_verified: false },
    { firebase: { sign_in_provider: 'password' } },
    { firebase: { sign_in_provider: 'anonymous' } }
  ]) await assertFails(getDoc(job(client(owner, claims))));
});

test('each approved Google account can read jobs and its own approval, never others or user lists', async () => {
  for (const email of emails) {
    const db = client(email);
    await assertSucceeds(getDoc(job(db)));
    await assertSucceeds(getDocs(collection(db, 'jobs')));
    await assertSucceeds(getDoc(doc(db, '_crmAccess', email)));
    await assertFails(getDoc(doc(db, '_crmAccess', email === owner ? staff : owner)));
    await assertFails(getDocs(collection(db, '_crmAccess')));
  }
});

test('approved users can create jobs, edit dates and archive without losing claims or extras', async () => {
  const db = client();
  await assertSucceeds(setDoc(doc(db, 'jobs', 'new-job'), { clientName: 'Test new lead', status: 'lead' }));
  await assertSucceeds(updateDoc(job(db), { startDate: '2026-11-11', endDate: '2026-11-13', archived: true }));
  const saved = (await getDoc(job(db))).data();
  assert.equal(saved.claims[0].amount, 100);
  assert.equal(saved.extras[0].amount, 50);
  assert.equal(saved.calendarSync.status, 'synced');
  await assertSucceeds(deleteDoc(doc(db, 'jobs', 'new-job')));
});

test('approval documents cannot be self-created, modified or deleted by CRM clients', async () => {
  const db = client();
  for (const email of [owner, 'outsider@example.test']) {
    const ref = doc(db, '_crmAccess', email);
    await assertFails(setDoc(ref, { enabled: true }));
    await assertFails(updateDoc(ref, { enabled: true }));
    await assertFails(deleteDoc(ref));
  }
});

test('clients cannot forge sync metadata, baselines, controls or other collections', async () => {
  const db = client();
  await assertFails(updateDoc(job(db), { calendarSync: { status: 'synced', forged: true } }));
  await assertFails(setDoc(doc(db, 'jobs', 'forged-job'), { calendarSync: { status: 'synced' } }));
  for (const name of ['_calendarSyncState', '_calendarSyncControl', 'unknownCollection']) {
    const ref = doc(db, name, 'main');
    await assertFails(getDoc(ref));
    await assertFails(getDocs(collection(db, name)));
    await assertFails(setDoc(ref, { initialized: true }));
  }
});

test('disabling approval immediately denies subsequent server reads and writes', async () => {
  const db = client();
  await assertSucceeds(getDoc(job(db)));
  await env.withSecurityRulesDisabled(context => updateDoc(
    doc(context.firestore(), '_crmAccess', owner), { enabled: false }
  ));
  await assertFails(getDoc(job(db)));
  await assertFails(updateDoc(job(db), { status: 'completed' }));
});

test('trusted administrative writes are not blocked by client rules', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'jobs', 'website-server-test'), { clientName: 'FICTIONAL server enquiry' });
    await updateDoc(job(db), { calendarSync: { status: 'attention' } });
  });
  assert.equal((await getDoc(job(client()))).data().calendarSync.status, 'attention');
});
