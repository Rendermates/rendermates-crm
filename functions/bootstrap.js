// Run once with sync DISABLED and only after granting the reviewed identities.
// Reads Google; writes only additive sync metadata and job calendarSync status.
// Never modifies job dates, payments, extras, contacts, or Google events.
import { FieldValue } from 'firebase-admin/firestore';
import { database, dependencies } from './runtime.js';
import { archived, syncJob } from './sync-core.js';

const calendarId = process.env.GOOGLE_CALENDAR_ID;
const writer = process.env.GOOGLE_CALENDAR_WRITER;
if (process.env.CALENDAR_SYNC_ENABLED !== 'false' ||
    process.env.CONFIRM_CALENDAR_BOOTSTRAP !== 'yes') {
  throw new Error('Disable synchronization and explicitly confirm bootstrap before running');
}
const db = database();
const control = db.collection('_calendarSyncControl').doc('main');
if ((await control.get()).data()?.initialized) {
  throw new Error('Already initialized; do not reset live synchronization baselines');
}
const clients = await dependencies(calendarId, writer);
const counts = {};
let cursor;
do {
  let query = db.collection('jobs').orderBy('__name__').limit(100);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  for (const job of page.docs) {
    if (archived(job.data())) continue;
    const result = await syncJob({ jobId: job.id, ...clients, bootstrap: true });
    if (result.action === 'busy' || result.action === 'retry') {
      throw new Error('Bootstrap encountered concurrent changes; keep sync disabled and retry');
    }
    counts[result.action] = (counts[result.action] || 0) + 1;
  }
  cursor = page.size === 100 ? page.docs.at(-1) : null;
} while (cursor);
await control.set({ initialized: true, calendarId, initializedAt: FieldValue.serverTimestamp() });
console.log(JSON.stringify({ initialized: true, counts }));
