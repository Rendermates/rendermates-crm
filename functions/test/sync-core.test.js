import test from 'node:test';
import assert from 'node:assert/strict';
import { planSync, syncJob, newEvent, shiftDate, eventIdForJob, isAllowed } from '../sync-core.js';
import { firestoreStore } from '../firestore-store.js';

const jobId = 'AbZ123';
const first = { startDate: '2026-11-05', endDate: '2026-11-10' };
const second = { startDate: '2026-12-07', endDate: '2026-12-11' };
const third = { startDate: '2027-01-02', endDate: '2027-01-08' };
const job = { ...first, clientName: 'TEST calendar pilot', contractAmount: 1200,
  claims: [{ id: 1, amount: 100, status: 'Paid' }], extras: [{ amount: 50 }], notes: 'Preserve me' };
const eventFor = dates => ({ ...newEvent(jobId, job, dates), etag: '"version-1"' });
const decide = (local, remote, state = { base: first }) =>
  planSync({ jobId, job: { ...job, ...local }, event: eventFor(remote), state });

test('inclusive CRM dates use exclusive Google end dates across leap/year/DST boundaries', () => {
  assert.equal(shiftDate('2028-02-28', 1), '2028-02-29');
  assert.equal(shiftDate('2028-02-29', 1), '2028-03-01');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDate('2026-09-27', 1), '2026-09-28');
  assert.equal(shiftDate('2027-04-04', 1), '2027-04-05');
  const oneDay = newEvent(jobId, job, { startDate: first.startDate, endDate: first.startDate });
  assert.equal(oneDay.end.date, '2026-11-06');
  assert.throws(() => shiftDate('2026-02-29', 1));
  assert.match(eventIdForJob(jobId), /^[0-9a-v]{5,}$/);
  assert.equal(eventIdForJob(jobId), 'c41625a313233');
});

test('default gate denies every job; pilot allowlist is exact, explicit wildcard enables all', () => {
  assert.equal(isAllowed(jobId, false, '*'), false);
  assert.equal(isAllowed(jobId, true, ''), false);
  assert.equal(isAllowed(jobId, true, 'AbZ'), false);
  assert.equal(isAllowed(jobId, true, ' other, AbZ123 '), true);
  assert.equal(isAllowed(jobId, true, '*'), true);
});

test('three-way baseline selects one direction and detects simultaneous conflicting edits', () => {
  assert.equal(decide(first, first).action, 'adopt');
  assert.equal(decide(second, first).action, 'push');
  assert.equal(decide(first, second).action, 'pull');
  assert.equal(decide(second, second).action, 'adopt');
  assert.deepEqual(decide(second, third), { action: 'attention', reason: 'both_schedules_changed' });
  assert.equal(decide(second, first, {}).reason, 'initial_dates_differ');
});

test('deleted events, archived work, invalid dates and unknown/timed/recurring events are never overwritten', () => {
  const base = { jobId, job, state: { base: first } };
  assert.equal(planSync({ ...base, event: null }).reason, 'google_event_missing');
  assert.equal(planSync({ ...base, event: { status: 'cancelled' } }).reason, 'google_event_missing');
  assert.equal(planSync({ ...base, job: { ...job, archived: true } }).action, 'skip');
  assert.equal(planSync({ ...base, job: { ...job, endDate: '2026-02-30' } }).reason, 'invalid_or_missing_dates');
  assert.equal(planSync({ ...base, event: { ...eventFor(first), extendedProperties: {} } }).reason, 'event_identity_mismatch');
  assert.equal(planSync({ ...base, event: { ...eventFor(first), start: { dateTime: '2026-11-05T09:00:00+13:00' } } }).reason, 'unsupported_google_schedule');
  assert.equal(planSync({ ...base, event: { ...eventFor(first), recurrence: ['RRULE:FREQ=DAILY'] } }).reason, 'unsupported_google_schedule');
  assert.equal(planSync({ ...base, event: null, state: {}, bootstrap: true }).reason, 'google_event_missing');
});

// Exercise the actual Firestore adapter against a transactional in-memory fixture.
function fixture(local = first, remote = first, initialState = { base: first }) {
  const data = new Map([
    [`jobs/${jobId}`, { ...structuredClone(job), ...local }],
    [`_calendarSyncState/${jobId}`, structuredClone(initialState)]
  ]);
  const writes = [];
  const reference = path => ({ path, get: async () => snapshot(path) });
  const snapshot = path => ({
    data: () => data.get(path) ? structuredClone(data.get(path)) : undefined
  });
  const db = {
    collection: name => ({ doc: id => reference(`${name}/${id}`) }),
    runTransaction: async fn => fn({
      get: async ref => snapshot(ref.path),
      set: (ref, value, options) => {
        data.set(ref.path, options?.merge ? { ...data.get(ref.path), ...value } : value);
      },
      update: (ref, value) => {
        writes.push({ path: ref.path, keys: Object.keys(value) });
        data.set(ref.path, { ...data.get(ref.path), ...value });
      }
    })
  };
  let event = remote ? eventFor(remote) : null;
  const calls = [];
  const calendar = {
    get: async () => event ? structuredClone(event) : null,
    create: async value => {
      calls.push('create');
      if (event) throw Object.assign(new Error('Already exists'), { status: 409 });
      event = { ...value, etag: '"version-1"' };
    },
    patch: async (id, value, etag) => {
      calls.push('patch');
      assert.equal(id, event.id);
      assert.equal(etag, event.etag);
      event = { ...event, ...value, etag: '"version-2"' };
    }
  };
  return { store: firestoreStore(db), calendar, calls, data, writes,
    getEvent: () => event, setEvent: e => { event = e; } };
}

test('Google date edits pull only start/end; money, claims, extras, status and notes survive', async () => {
  const f = fixture(first, second);
  const before = structuredClone(f.data.get(`jobs/${jobId}`));
  assert.equal((await syncJob({ jobId, ...f })).action, 'pull');
  const after = f.data.get(`jobs/${jobId}`);
  const { startDate, endDate, calendarSync, ...preserved } = after;
  const { startDate: _s, endDate: _e, ...original } = before;
  assert.deepEqual(preserved, original);
  assert.deepEqual({ startDate, endDate }, second);
  assert.equal(calendarSync.status, 'synced');
  assert.deepEqual(f.calls, []);
  assert.ok(f.writes.filter(w => w.path.startsWith('jobs/'))
    .every(w => w.keys.every(key => ['startDate', 'endDate', 'calendarSync'].includes(key))));
  assert.equal((await syncJob({ jobId, ...f })).action, 'adopt');
  assert.deepEqual(f.calls, []);
});

test('CRM dates push with ETag, do not loop, and do not change unrelated Google fields', async () => {
  const f = fixture(second, first);
  f.setEvent({ ...f.getEvent(), description: 'Google-only note', colorId: '5' });
  assert.equal((await syncJob({ jobId, ...f })).action, 'push');
  assert.equal(f.getEvent().description, 'Google-only note');
  assert.equal(f.getEvent().colorId, '5');
  assert.equal((await syncJob({ jobId, ...f })).action, 'adopt');
  assert.deepEqual(f.calls, ['patch']);
});

test('create retries adopt the deterministic event, never duplicate it', async () => {
  const f = fixture(first, null, {});
  assert.equal((await syncJob({ jobId, ...f })).action, 'create');
  assert.equal((await syncJob({ jobId, ...f })).action, 'adopt');
  assert.deepEqual(f.calls, ['create']);
});

test('bootstrap adopts imported events without writing Google or changing existing dates', async () => {
  const f = fixture(first, first, {});
  assert.equal((await syncJob({ jobId, ...f, bootstrap: true })).action, 'adopt');
  assert.deepEqual(f.calls, []);
  assert.ok(f.writes.filter(w => w.path.startsWith('jobs/'))
    .every(w => w.keys.every(key => key === 'calendarSync')));
  const missing = fixture(first, null, {});
  assert.equal((await syncJob({ jobId, ...missing, bootstrap: true })).reason, 'google_event_missing');
  assert.equal((await syncJob({ jobId, ...missing })).reason, 'google_event_missing');
  assert.deepEqual(missing.calls, []);
});

test('a previously unscheduled job can be scheduled later without inventing dates', async () => {
  const f = fixture({ startDate: '', endDate: '' }, null, {});
  assert.equal((await syncJob({ jobId, ...f, bootstrap: true })).reason, 'unscheduled');
  Object.assign(f.data.get(`jobs/${jobId}`), first);
  assert.equal((await syncJob({ jobId, ...f })).action, 'create');
});

test('a CRM edit during Google fetch is preserved, not overwritten by a pull', async () => {
  const f = fixture(first, second);
  const get = f.calendar.get;
  f.calendar.get = async id => {
    const event = await get(id);
    Object.assign(f.data.get(`jobs/${jobId}`), third);
    return event;
  };
  assert.equal((await syncJob({ jobId, ...f })).action, 'retry');
  assert.deepEqual({ ...f.data.get(`jobs/${jobId}`), ...third }, f.data.get(`jobs/${jobId}`));
  assert.deepEqual(f.calls, []);
});

test('an in-flight outgoing update checkpoints what was sent and preserves a newer CRM edit', async () => {
  const f = fixture(second, first);
  const patch = f.calendar.patch;
  f.calendar.patch = async (...args) => {
    await patch(...args);
    Object.assign(f.data.get(`jobs/${jobId}`), third);
  };
  assert.equal((await syncJob({ jobId, ...f })).action, 'retry');
  assert.equal(f.data.get(`jobs/${jobId}`).startDate, third.startDate);
  assert.deepEqual(f.data.get(`_calendarSyncState/${jobId}`).base, second);
  f.calendar.patch = patch;
  assert.equal((await syncJob({ jobId, ...f })).action, 'push');
  assert.equal(f.getEvent().start.date, third.startDate);
});

test('ETag rejection is retried without changing job dates or resetting baseline', async () => {
  const f = fixture(second, first);
  f.calendar.patch = async () => { throw Object.assign(new Error('Changed'), { status: 412 }); };
  await assert.rejects(syncJob({ jobId, ...f }), { status: 412 });
  assert.equal(f.data.get(`jobs/${jobId}`).startDate, second.startDate);
  assert.deepEqual(f.data.get(`_calendarSyncState/${jobId}`).base, first);
  assert.equal(f.data.get(`jobs/${jobId}`).calendarSync.status, 'pending');
});

test('an active lease prevents concurrent workers', async () => {
  const f = fixture();
  f.data.get(`_calendarSyncState/${jobId}`).lease = { owner: 'other', until: Date.now() + 90_000 };
  assert.equal((await syncJob({ jobId, ...f })).action, 'busy');
  assert.deepEqual(f.calls, []);
});
