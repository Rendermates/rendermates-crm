import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { archived, sameDates, jobDates } from './sync-core.js';

const sameSchedule = (a, b) => Boolean(a && b) &&
  sameDates(jobDates(a), jobDates(b)) && archived(a) === archived(b);

export function firestoreStore(db) {
  const jobRef = id => db.collection('jobs').doc(id);
  const stateRef = id => db.collection('_calendarSyncState').doc(id);
  return {
    async acquire(id) {
      const owner = randomUUID();
      return db.runTransaction(async tx => {
        const ref = stateRef(id);
        const snap = await tx.get(ref);
        if ((snap.data()?.lease?.until || 0) > Date.now()) return null;
        tx.set(ref, { lease: { owner, until: Date.now() + 90_000 } }, { merge: true });
        return owner;
      });
    },
    async read(id) {
      const [job, state] = await Promise.all([jobRef(id).get(), stateRef(id).get()]);
      const { lease: _lease, ...metadata } = state.data() || {};
      return { job: job.data(), state: metadata };
    },
    async stillCurrent(id, owner, expectedJob) {
      const [job, state] = await Promise.all([jobRef(id).get(), stateRef(id).get()]);
      return state.data()?.lease?.owner === owner &&
        state.data().lease.until > Date.now() && sameSchedule(job.data(), expectedJob);
    },
    async finish(id, owner, expectedJob, next, pullDates = null, outboundApplied = false) {
      return db.runTransaction(async tx => {
        const [job, state] = await Promise.all([tx.get(jobRef(id)), tx.get(stateRef(id))]);
        if (state.data()?.lease?.owner !== owner || state.data().lease.until <= Date.now()) return false;
        const current = job.data();
        if (!sameSchedule(current, expectedJob)) {
          // A newer CRM edit must survive an in-flight Google update. Checkpoint
          // that update so the next pass can send the newer CRM dates safely.
          if (outboundApplied) tx.set(stateRef(id), {
            ...next, status: 'pending', reason: '', checkedAt: FieldValue.serverTimestamp()
          }, { merge: true });
          return false;
        }
        tx.set(stateRef(id), { ...next, checkedAt: FieldValue.serverTimestamp() }, { merge: true });
        const summaryChanged = current.calendarSync?.status !== next.status ||
          current.calendarSync?.reason !== next.reason;
        if (pullDates || summaryChanged || outboundApplied) {
          tx.update(jobRef(id), {
            ...(pullDates ? { startDate: pullDates.startDate, endDate: pullDates.endDate } : {}),
            calendarSync: { status: next.status, reason: next.reason, checkedAt: FieldValue.serverTimestamp() }
          });
        }
        return true;
      });
    },
    async release(id, owner) {
      await db.runTransaction(async tx => {
        const ref = stateRef(id);
        const state = await tx.get(ref);
        if (state.data()?.lease?.owner === owner) {
          tx.update(ref, { lease: FieldValue.delete() });
        }
      });
    }
  };
}
