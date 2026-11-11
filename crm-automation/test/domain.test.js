import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, analytics, canEmail, formatAddress, membershipRole, nzDay, profilePatch, ruleOccurrence, stagePatch, validateRule, validEmail } from '../domain.js';
import { buildEmail, deliveryEligible, deliveryId, hash, sendGmail, suppressionId, unsubscribeToken, verifyUnsubscribe } from '../mail.js';

const actor = 'rep@example.test';
const consent = { optIn: true, source: 'Fictional explicit permission', recordedAt: '2026-10-01', recordedBy: actor };
const job = { id: 'fake-job', clientName: 'Example Customer', email: 'fictional@example.test', status: 'completed',
  address: 'TEST ONLY', contactPreferences: { maintenance: consent, marketing: consent, follow_up: consent },
  lastPurchaseDate: '2025-11-11', createdAt: '2026-01-01T00:00:00Z', closedWonAt: '2026-01-11T00:00:00Z' };
const rule = { name: 'Maintenance', kind: 'maintenance', trigger: 'maintenance', months: 12, enabled: true, subject: 'Hello {{name}}', body: 'Your property: {{address}}' };
const secret = 'fictional-local-test-signing-key-never-used-outside-tests';

test('roles require enabled membership; only the existing two owners get a legacy default', () => {
  assert.equal(membershipRole('rep@example.test', { enabled: true }), null);
  assert.equal(membershipRole('rep@example.test', { enabled: true, role: 'sales' }), 'sales');
  assert.equal(membershipRole('info@rendermates.co.nz', { enabled: true }), 'admin');
  assert.equal(membershipRole('info@rendermates.co.nz', { enabled: true, role: 'invalid' }), null);
  assert.equal(membershipRole('rep@example.test', { enabled: false, role: 'manager' }), null);
});
test('structured address retains legacy plain text and never requires a mapping service', () => {
  assert.equal(formatAddress({}, 'Legacy address'), 'Legacy address');
  assert.equal(formatAddress({ unit: '2', street: 'Test Street', city: 'Wellington', postalCode: '0000' }), 'Unit 2, Test Street, Wellington, 0000');
});
test('lost transitions require selection and Other explanation; wins stamp once', () => {
  assert.throws(() => stagePatch(job, 'lost'), /reason/);
  assert.throws(() => stagePatch(job, 'lost', { lossReason: 'Other' }), /Explain/);
  assert.equal(stagePatch(job, 'lost', { lossReason: 'Price' }, '2026-11-11').closedLostAt, '2026-11-11');
  assert.equal(stagePatch({ status: 'lead' }, 'booked', {}, '2026-11-11').closedWonAt, '2026-11-11');
  assert.equal(stagePatch(job, 'completed').closedWonAt, undefined);
  assert.equal(stagePatch({ status: 'completed' }, 'completed').closedWonAt, undefined);
  assert.equal(profilePatch({ ...job, closedWonAt: null }, job, actor).closedWonAt, undefined);
  assert.throws(() => stagePatch(job, 'invented'), /valid/);
});
test('customer editing does not write money, dates or sync fields and records consent evidence', () => {
  const patch = profilePatch(job, { ...job, clientName: 'Updated', customerNotes: 'A call', status: 'quoted' }, actor);
  for (const key of ['claims', 'extras', 'contractAmount', 'calendarSync', 'startDate', 'endDate']) assert.equal(Object.hasOwn(patch, key), false);
  assert.equal(patch.clientName, 'Updated');
  assert.equal(patch.contactPreferences.maintenance.optIn, true);
  assert.throws(() => profilePatch(job, { ...job, contactPreferences: { marketing: { optIn: true } } }, actor), /consent source/);
  assert.throws(() => profilePatch(job, { ...job, nextFollowUpDate: '2026-02-30' }, actor), /valid follow-up/);
});
test('changing recipient resets all email consent; header injection and extra recipients fail validation', () => {
  const patch = profilePatch(job, { ...job, email: 'new@example.test' }, actor);
  assert.equal(patch.contactPreferences.marketing.optIn, false);
  for (const email of ['a@example.test,b@example.test', 'a@example.test\r\nBcc: attacker@example.test', 'a@example.test>', 'bad address']) assert.equal(validEmail(email), false);
  const cleared = profilePatch({ ...job, clientEmail: job.email }, { ...job, email: '', address: '' }, actor);
  assert.equal(cleared.clientEmail, '');
  assert.equal(cleared.address, '');
});
test('analytics use dated wins, disclose missing dates and preserve zero/unknown distinctions', () => {
  const data = analytics([job, { ...job, id: 'undated', closedWonAt: null }, { status: 'lost', lossReason: 'Price', createdAt: '2026-11-10' }, { ...job, isTest: true }], new Date('2026-11-11'));
  assert.equal(data.total, 3); assert.equal(data.won, 2); assert.equal(data.cycleDays, 10);
  assert.equal(data.cycleSamples, 1); assert.equal(data.missingCycles, 1); assert.equal(data.excluded, 1);
  assert.equal(data.losses[0].reason, 'Price'); assert.equal(data.volume.at(-1).count, 1);
  assert.equal(analytics([]).cycleDays, null); assert.equal(analytics([]).conversion, 0);
});
test('maintenance dates clamp month-end and Wellington date boundaries handle DST', () => {
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
  assert.equal(addMonths('2026-02-30', 12), null);
  assert.equal(nzDay(new Date('2026-11-10T12:00:00Z')), '2026-11-11');
  assert.equal(ruleOccurrence(rule, job, '2026-11-11'), '2026-11-11');
  assert.equal(ruleOccurrence(rule, job, '2026-11-12'), null);
});
test('each category needs its own consent and rules never auto-opt in anyone', () => {
  assert.equal(canEmail(job, 'maintenance'), true);
  for (const value of [{}, { marketing: consent }, { maintenance: { optIn: true } }, { maintenance: { optIn: false, source: 'unsubscribe' } }]) {
    assert.equal(ruleOccurrence(rule, { ...job, contactPreferences: value }, '2026-11-11'), null);
  }
  assert.equal(canEmail({ ...job, archived: true }, 'marketing'), false);
  assert.throws(() => validateRule({ ...rule, months: 0 }));
  assert.throws(() => validateRule({ ...rule, trigger: 'annual', monthDay: '02-30' }));
  assert.equal(ruleOccurrence({ ...rule, trigger: 'annual', monthDay: '12-25' }, job, '2026-12-25'), '2026-12-25');
  assert.equal(ruleOccurrence({ ...rule, trigger: 'follow_up' }, { ...job, nextFollowUpDate: '2026-11-11' }, '2026-11-11'), '2026-11-11');
});
test('delivery keys are deterministic per occurrence and suppression is normalized per category', () => {
  assert.equal(deliveryId('rule', 'job', 'date'), deliveryId('rule', 'job', 'date'));
  assert.notEqual(deliveryId('rule', 'job', 'date'), deliveryId('rule', 'job', 'next'));
  assert.equal(suppressionId('User@Example.test', 'marketing'), suppressionId('user@example.test', 'marketing'));
  assert.notEqual(suppressionId('user@example.test', 'marketing'), suppressionId('user@example.test', 'maintenance'));
});
test('unsubscribe token is scoped, signed, expiring and cannot be tampered with', () => {
  const payload = { jobId: 'fake-job', kind: 'marketing', emailHash: hash(job.email), expires: Date.now() + 10000 };
  const token = unsubscribeToken(payload, secret);
  assert.deepEqual(verifyUnsubscribe(token, secret), payload);
  assert.equal(verifyUnsubscribe(token + '.extra', secret), null);
  assert.equal(verifyUnsubscribe(token, secret + 'wrong'), null);
  assert.equal(verifyUnsubscribe(token, secret, payload.expires + 1), null);
  assert.equal(verifyUnsubscribe('garbage', secret), null);
});
test('plain-text email contains an opt-out and uses strict addresses and encoded headers', () => {
  const message = buildEmail({ rule, job, jobId: job.id, from: 'sender@example.test', unsubscribeUrl: 'https://example.test/unsubscribe', secret, id: 'fictional-id' });
  const raw = Buffer.from(message.raw, 'base64url').toString('utf8');
  assert.match(raw, /List-Unsubscribe: <https:\/\/example.test\/unsubscribe\?token=/);
  assert.match(raw, /Content-Type: text\/plain/);
  assert.match(raw, /Message-ID: <fictional-id@rendermates.co.nz>/);
  assert.throws(() => buildEmail({ rule, job: { ...job, contactPreferences: {} }, from: 'sender@example.test' }));
});
test('Gmail transport uses only mocked calls and refuses ambiguous acceptance', async () => {
  const calls = [];
  const auth = { sender: 'sender@example.test', clientId: 'fictional-client', clientSecret: 'fictional-secret', refreshToken: 'fictional-refresh' };
  const mock = async (url, options) => {
    calls.push([url, options]);
    return { ok: true, json: async () => url.includes('oauth2') ? { access_token: 'fictional-token' } : { id: 'accepted-fictional-message' } };
  };
  assert.equal(await sendGmail(auth, { raw: 'test' }, mock), 'accepted-fictional-message');
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  await assert.rejects(sendGmail(auth, {}, async url => ({ ok: true, json: async () => url.includes('oauth2') ? { access_token: 'test' } : {} })), /uncertain/);
});
test('dispatch rechecks the sending gate, current rule, consent, recipient, due date and expiry', () => {
  const now = Date.parse('2026-11-11T00:00:00Z');
  const delivery = { kind: 'maintenance', createdAt: '2026-11-11T00:00:00Z', recipientHash: hash(job.email), occurrence: '2026-11-11' };
  const input = { job, rule, delivery, enabled: true, now };
  assert.equal(deliveryEligible(input), true);
  assert.equal(deliveryEligible({ ...input, enabled: false }), false);
  assert.equal(deliveryEligible({ ...input, suppressed: true }), false);
  assert.equal(deliveryEligible({ ...input, rule: { ...rule, enabled: false } }), false);
  assert.equal(deliveryEligible({ ...input, job: { ...job, email: 'other@example.test' } }), false);
  assert.equal(deliveryEligible({ ...input, job: { ...job, contactPreferences: {} } }), false);
  assert.equal(deliveryEligible({ ...input, job: { ...job, lastPurchaseDate: '2025-12-11' } }), false);
  assert.equal(deliveryEligible({ ...input, delivery: { ...delivery, createdAt: '2026-11-01' } }), false);
  assert.equal(deliveryEligible({ ...input, now: Date.parse('2026-11-12') }), false);
});
