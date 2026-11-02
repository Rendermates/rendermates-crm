// Date-only work schedules. No financial, contact, or status fields are imported.
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shiftDate(value, days) {
  if (!validDate(value)) throw new Error('Invalid schedule date');
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const result = date.toISOString().slice(0, 10);
  if (!validDate(result)) throw new Error('Date outside supported range');
  return result;
}

export const sameDates = (a, b) => Boolean(a && b &&
  a.startDate === b.startDate && a.endDate === b.endDate);
export const jobDates = job => ({ startDate: job?.startDate || '', endDate: job?.endDate || '' });
export const validRange = dates => validDate(dates?.startDate) &&
  validDate(dates?.endDate) && dates.startDate <= dates.endDate;
export const archived = job => Boolean(job?.archived || job?.archivedAt);
// Matches the deterministic IDs used for the existing 11 imported events.
export const eventIdForJob = jobId => `c${Buffer.from(jobId, 'utf8').toString('hex')}`;

export function isAllowed(jobId, enabled, allowedIds) {
  return enabled === true && allowedIds.split(',').map(id => id.trim())
    .filter(Boolean).some(id => id === '*' || id === jobId);
}

export function calendarDates(event) {
  if (event?.recurrence?.length || event?.recurringEventId ||
      event?.start?.dateTime || event?.end?.dateTime ||
      !validDate(event?.start?.date) || !validDate(event?.end?.date)) return null;
  const dates = { startDate: event.start.date, endDate: shiftDate(event.end.date, -1) };
  return validRange(dates) ? dates : null;
}

export function planSync({ jobId, job, event, state, bootstrap = false }) {
  if (!job || archived(job)) return { action: 'skip', reason: 'missing_or_archived' };
  const local = jobDates(job);
  if (!local.startDate && !local.endDate) return { action: 'skip', reason: 'unscheduled' };
  if (!validRange(local)) return { action: 'attention', reason: 'invalid_or_missing_dates' };
  if (!event || event.status === 'cancelled') {
    // Bootstrap never creates events. Known deleted/missing events are not recreated.
    if (bootstrap || state?.blockCreate || state?.base || event?.status === 'cancelled') {
      return { action: 'attention', reason: 'google_event_missing' };
    }
    return { action: 'create', dates: local };
  }
  if (event.id !== eventIdForJob(jobId) ||
      event.extendedProperties?.private?.crmJobId !== jobId ||
      event.extendedProperties?.private?.crmSource !== 'rendermates-crm') {
    return { action: 'attention', reason: 'event_identity_mismatch' };
  }
  const remote = calendarDates(event);
  if (!remote) return { action: 'attention', reason: 'unsupported_google_schedule' };
  if (sameDates(local, remote)) return { action: 'adopt', dates: local };
  if (bootstrap || !validRange(state?.base)) {
    return { action: 'attention', reason: 'initial_dates_differ' };
  }
  if (sameDates(local, state.base)) return { action: 'pull', dates: remote };
  if (sameDates(remote, state.base)) return { action: 'push', dates: local };
  return { action: 'attention', reason: 'both_schedules_changed' };
}

export function newEvent(jobId, job, dates) {
  return {
    id: eventIdForJob(jobId),
    summary: job.clientName || job.name || 'Rendermates job',
    location: job.address || '',
    description: 'Work schedule linked to Rendermates CRM.\nhttps://rendermates-crm.vercel.app/',
    start: { date: dates.startDate },
    end: { date: shiftDate(dates.endDate, 1) },
    extendedProperties: { private: { crmJobId: jobId, crmSource: 'rendermates-crm' } },
    visibility: 'private',
    reminders: { useDefault: false },
    source: { title: 'Rendermates CRM', url: 'https://rendermates-crm.vercel.app/' }
  };
}

// Store transactions protect CRM edits; Google If-Match protects Google edits.
// APIs can succeed then time out: deterministic event IDs make retries idempotent.
export async function syncJob({ jobId, store, calendar, bootstrap = false }) {
  const lease = await store.acquire(jobId);
  if (!lease) return { action: 'busy' };
  let snapshot;
  try {
    const { job, state } = await store.read(jobId);
    snapshot = { job, state };
    if (!job || archived(job)) return { action: 'skip' };
    const eventId = eventIdForJob(jobId);
    const event = await calendar.get(eventId);
    const plan = planSync({ jobId, job, event, state, bootstrap });
    if (plan.action === 'skip') return plan;
    if (plan.action === 'attention') {
      await store.finish(jobId, lease, job, {
        ...state, eventId, status: 'attention', reason: plan.reason,
        ...(plan.reason === 'google_event_missing' ? { blockCreate: true } : {})
      });
      return plan;
    }
    if (!await store.stillCurrent(jobId, lease, job)) return { action: 'retry' };
    if (plan.action === 'create') {
      await calendar.create(newEvent(jobId, job, plan.dates));
    } else if (plan.action === 'push') {
      if (!event.etag) throw new Error('Google event has no concurrency token');
      await calendar.patch(eventId, {
        start: { date: plan.dates.startDate },
        end: { date: shiftDate(plan.dates.endDate, 1) }
      }, event.etag);
    }
    const completed = await store.finish(jobId, lease, job, {
      eventId, base: plan.dates, status: 'synced', reason: ''
    }, plan.action === 'pull' ? plan.dates : null,
    ['push', 'create'].includes(plan.action));
    return completed ? plan : { action: 'retry' };
  } catch (error) {
    if (snapshot?.job && !archived(snapshot.job)) {
      const denied = error.status === 401 || error.status === 403;
      try {
        await store.finish(jobId, lease, snapshot.job, {
          ...snapshot.state,
          status: denied ? 'attention' : 'pending',
          reason: denied ? 'google_access_denied' : 'retry_pending'
        });
      } catch { /* Keep the original failure; the scheduler will retry. */ }
    }
    throw error;
  } finally {
    await store.release(jobId, lease);
  }
}
