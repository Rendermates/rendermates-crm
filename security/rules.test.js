import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';

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

test('Google sign-in and an enabled record without an explicit new-user role are insufficient', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(
    doc(context.firestore(), '_crmAccess', 'outsider@example.test'), { enabled: true }
  ));
  const db = client('outsider@example.test');
  await assertFails(getDocs(collection(db, 'jobs')));
  await assertFails(updateDoc(job(db), { startDate: '2026-11-20' }));
  await assertSucceeds(getDoc(doc(db, '_crmAccess', 'outsider@example.test')));
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

test('sales role can query only assigned leads and cannot take another lead or escalate membership', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, '_crmAccess', 'rep@example.test'), { enabled: true, role: 'sales' });
    await updateDoc(job(db), { assignedTo: 'rep@example.test' });
    await setDoc(doc(db, 'jobs', 'other-lead'), { clientName: 'Other lead', assignedTo: owner, status: 'lead' });
  });
  const db = client('rep@example.test');
  await assertSucceeds(getDoc(job(db)));
  await assertSucceeds(getDocs(query(collection(db, 'jobs'), where('assignedTo', '==', 'rep@example.test'))));
  await assertFails(getDocs(collection(db, 'jobs')));
  await assertFails(getDoc(doc(db, 'jobs', 'other-lead')));
  await assertFails(updateDoc(doc(db, 'jobs', 'other-lead'), { assignedTo: 'rep@example.test' }));
  await assertFails(updateDoc(job(db), { assignedTo: owner }));
  await assertFails(deleteDoc(job(db)));
  await assertFails(updateDoc(doc(db, '_crmAccess', 'rep@example.test'), { role: 'admin' }));
  await assertFails(getDocs(collection(db, 'crmEmailRules')));
  await assertFails(getDocs(collection(db, 'crmEmailOutbox')));
});

test('loss reason and consent evidence are enforced even without the UI', async () => {
  const db = client();
  await assertFails(updateDoc(job(db), { status: 'lost' }));
  await assertFails(updateDoc(job(db), { status: 'lost', lossReason: 'Other', lossNotes: '' }));
  await assertFails(updateDoc(job(db), { status: 'lost', lossReason: 'Other', lossNotes: '  \n ' }));
  await assertSucceeds(updateDoc(job(db), { status: 'lost', lossReason: 'Other', lossNotes: 'First line\nSecond line' }));
  await assertSucceeds(updateDoc(job(db), { status: 'lost', lossReason: 'Price', lossNotes: 'Fictional reason' }));
  await assertFails(updateDoc(job(db), { contactPreferences: { marketing: { optIn: true } } }));
  await assertSucceeds(updateDoc(job(db), { contactPreferences: {
    marketing: { optIn: true, source: 'Fictional consent for emulator test', recordedBy: owner, recordedAt: '2026-11-11T00:00:00Z' }
  } }));
  await assertFails(updateDoc(job(db), { contactPreferences: {
    marketing: { optIn: true, source: 'Forged actor', recordedBy: staff, recordedAt: '2026-11-11' }
  } }));
});

test('message history is readable by assigned staff, append-only and cannot impersonate backend enquiries', async () => {
  const db = client();
  const ref = doc(db, 'jobs', 'fictional-job', 'messages', 'note');
  const data = { type: 'note', text: 'Fictional call note', actor: owner, createdAt: '2026-11-11', source: 'CRM manual log' };
  await assertSucceeds(setDoc(ref, data));
  await assertSucceeds(getDoc(ref));
  await assertFails(updateDoc(ref, { text: 'Changed audit history' }));
  await assertFails(deleteDoc(ref));
  await assertFails(setDoc(doc(db, 'jobs', 'fictional-job', 'messages', 'forged'), { ...data, type: 'incoming', source: 'website' }));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'jobs', 'fictional-job', 'messages', 'note')));
});

test('sales tasks are scoped to assignee; sending control and outbox remain server-owned', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, '_crmAccess', 'rep@example.test'), { enabled: true, role: 'sales' });
    await updateDoc(job(db), { assignedTo: 'rep@example.test' });
  });
  const db = client('rep@example.test');
  const ref = doc(db, 'crmTasks', 'task');
  const task = { title: 'Fictional follow-up', jobId: 'fictional-job', assignedTo: 'rep@example.test', dueAt: '2026-11-12T00:00:00Z', status: 'open', createdBy: 'rep@example.test', createdAt: '2026-11-11' };
  await assertSucceeds(setDoc(ref, task));
  await assertSucceeds(updateDoc(ref, { status: 'done' }));
  await assertFails(updateDoc(ref, { assignedTo: owner }));
  await assertFails(setDoc(doc(db, 'crmTasks', 'other'), { ...task, assignedTo: owner }));
  await assertFails(setDoc(doc(client(), '_crmAutomationControl', 'email'), { enabled: true }));
  await assertFails(setDoc(doc(client(), 'crmEmailOutbox', 'forged'), { status: 'sent' }));
});
test('an explicitly approved manager sees team records while invalid explicit roles cannot fall back', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), '_crmAccess', 'manager@example.test'), { enabled: true, role: 'manager' });
  });
  const managerDb = client('manager@example.test');
  await assertSucceeds(getDocs(collection(managerDb, 'jobs')));
  await assertSucceeds(getDocs(collection(managerDb, 'crmEmailRules')));
  await assertSucceeds(updateDoc(job(managerDb), { assignedTo: 'manager@example.test' }));
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), '_crmAccess', owner), { role: 'invalid' });
  });
  await assertFails(getDoc(job(client())));
});
