import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineBoolean, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { database, dependencies } from './runtime.js';
import { isAllowed, syncJob, sameDates, jobDates, archived } from './sync-core.js';

const enabled = defineBoolean('CALENDAR_SYNC_ENABLED', { default: false });
const allowed = defineString('CALENDAR_SYNC_JOB_IDS', { default: '' });
const calendarId = defineString('GOOGLE_CALENDAR_ID', { default: '' });
const writer = defineString('GOOGLE_CALENDAR_WRITER', { default: '' });
// The Firestore trigger stays beside the existing database in Melbourne.
const firestoreRegion = 'australia-southeast2';
// Cloud Scheduler supports Sydney, not Melbourne. This is not the business timezone.
const schedulerRegion = 'australia-southeast1';
// This identity must be provisioned and reviewed before deployment.
const serviceAccount = 'crm-calendar-sync@rendermates-crm.iam.gserviceaccount.com';
let clients;
const getClients = () => clients ||= dependencies(calendarId.value(), writer.value());

async function ready() {
  if (!enabled.value() || !allowed.value().trim()) return false;
  const control = await database().collection('_calendarSyncControl').doc('main').get();
  if (control.data()?.initialized !== true ||
      control.data()?.calendarId !== calendarId.value()) {
    throw new Error('Calendar bootstrap has not completed for this calendar');
  }
  return true;
}

async function reconcile(id) {
  if (!isAllowed(id, enabled.value(), allowed.value())) return;
  const result = await syncJob({ jobId: id, ...await getClients() });
  // Status only; customer names, dates, token values and event bodies stay out of logs.
  logger.info('Calendar reconciliation', { action: result.action, reason: result.reason || '' });
}

export const calendarJobDatesChanged = onDocumentWritten({
  document: 'jobs/{jobId}', region: firestoreRegion, serviceAccount,
  maxInstances: 2, concurrency: 1, timeoutSeconds: 120, retry: true
}, async event => {
  if (!event.data?.after.exists || !await ready()) return;
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (before && sameDates(jobDates(before), jobDates(after)) &&
      archived(before) === archived(after)) return;
  await reconcile(event.params.jobId);
});

export const calendarReconcile = onSchedule({
  schedule: 'every 5 minutes', timeZone: 'Pacific/Auckland', region: schedulerRegion,
  serviceAccount, timeoutSeconds: 300, maxInstances: 1, retryCount: 3
}, async () => {
  if (!await ready()) return;
  // Also repairs missed outgoing triggers. Read current records, not stale events.
  let cursor;
  let failed = false;
  do {
    let query = database().collection('jobs').orderBy('__name__').limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const job of page.docs) {
      try { await reconcile(job.id); }
      catch (error) {
        failed = true;
        logger.error('Calendar reconciliation failed', { status: error.status || 'internal' });
      }
    }
    cursor = page.size === 100 ? page.docs.at(-1) : null;
  } while (cursor);
  if (failed) throw new Error('Some calendar operations need retry');
});
