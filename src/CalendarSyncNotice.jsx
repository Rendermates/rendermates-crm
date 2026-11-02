const explanations = {
  google_event_missing: 'The Google event was removed or is missing. The CRM job has been kept.',
  both_schedules_changed: 'Dates changed in both calendars. Review both before choosing which dates to keep.',
  initial_dates_differ: 'The starting dates do not match. Review both calendars before enabling changes.',
  event_identity_mismatch: 'The Google event could not be safely matched to this job.',
  unsupported_google_schedule: 'Use a single all-day Google event for this work period, not a timed or recurring event.',
  invalid_or_missing_dates: 'Set a valid start and end date for this work period.',
  google_access_denied: 'The server cannot access the Google calendar. Check its calendar permission.',
  retry_pending: 'An update could not finish. The server will retry automatically.'
};

export default function CalendarSyncNotice({ jobs, onOpenJob }) {
  const problems = jobs.filter(job => ['attention', 'pending'].includes(job.calendarSync?.status) &&
    !job.archived && !job.archivedAt);
  if (!problems.length) return null;
  return (
    <section aria-label="Google Calendar sync status" role="status"
      style={{ padding: '14px', marginBottom: '16px', border: '1px solid #fbbf24', borderRadius: '10px', background: '#fffbeb', color: '#78350f' }}>
      <strong>Google Calendar sync needs attention ({problems.length})</strong>
      <p style={{ margin: '6px 0', fontSize: '12px' }}>Conflicting dates are not automatically overwritten. Removing a Google event never deletes a CRM job.</p>
      {problems.map(job => (
        <div key={job.id} style={{ marginTop: '10px', fontSize: '12px' }}>
          <button type="button" onClick={() => onOpenJob(job.id)}
            style={{ padding: '4px 0', border: 0, background: 'transparent', color: '#92400e', textDecoration: 'underline', textAlign: 'left', cursor: 'pointer', fontWeight: '700' }}>
            {job.clientName || job.name || 'Open job'}
          </button>
          <p style={{ margin: '2px 0' }}>{explanations[job.calendarSync.reason] || 'An update is pending. Check the job before changing its schedule.'}</p>
        </div>
      ))}
    </section>
  );
}
