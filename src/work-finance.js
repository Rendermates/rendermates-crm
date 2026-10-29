export const moneyCents = value => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
};

export const jobContractCents = job =>
  moneyCents(job.contractAmount) + (job.extras || []).reduce((sum, extra) => sum + moneyCents(extra.amount), 0);

export const jobOutstandingCents = job => Math.max(0,
  jobContractCents(job) - (job.claims || []).filter(claim => claim.status === 'Paid')
    .reduce((sum, claim) => sum + moneyCents(claim.amount), 0));

export function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const monthLabel = key => key === 'undated' ? 'No start date set' :
  new Date(`${key}-01T12:00:00`).toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' });

export function groupWork(jobs) {
  const groups = [
    { key: 'in_progress', label: 'In Progress', open: true, jobs: jobs.filter(job => job.status === 'in_progress') },
    { key: 'pipeline', label: 'Visits & Quotes', jobs: jobs.filter(job => ['site_visit', 'quoted'].includes(job.status)) },
    { key: 'booked', label: 'Accepted / Booked', months: true, jobs: jobs.filter(job => job.status === 'booked') },
    { key: 'completed', label: 'Completed', completed: true, jobs: jobs.filter(job => job.status === 'completed') },
  ];
  const known = new Set(['lead', 'in_progress', 'site_visit', 'quoted', 'booked', 'completed']);
  const others = jobs.filter(job => !known.has(job.status || 'lead'));
  if (others.length) groups.push({ key: 'other', label: 'Other Jobs', jobs: others });
  return groups.filter(group => group.jobs.length);
}

export function groupBookedMonths(jobs) {
  const months = new Map();
  for (const job of jobs) {
    const key = isDateKey(job.startDate) ? job.startDate.slice(0, 7) : 'undated';
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(job);
  }
  return [...months].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({ key, label: monthLabel(key), jobs: items }));
}

// Every claim is counted once: unpaid by expected date, paid by actual receipt date.
// Archived jobs retain their financial records; pipeline quotes are not committed receipts.
export function buildReceiptsForecast(jobs, today) {
  const rows = [];
  const unstaged = [];
  for (const job of jobs) {
    const accepted = ['booked', 'in_progress', 'completed'].includes(job.status);
    let stagedCents = 0;
    for (const claim of job.claims || []) {
      const cents = moneyCents(claim.amount);
      if (cents <= 0) continue;
      stagedCents += cents;
      const paid = claim.status === 'Paid';
      if (!accepted && !paid) continue;
      const date = paid ? claim.paidDate : claim.expectedDate;
      rows.push({
        job, claim, cents, paid, date: isDateKey(date) ? date : '',
        month: isDateKey(date) ? date.slice(0, 7) : 'undated',
        overdue: !paid && isDateKey(date) && date < today,
      });
    }
    if (accepted && jobContractCents(job) > stagedCents) {
      unstaged.push({ job, cents: jobContractCents(job) - stagedCents });
    }
  }
  const months = new Map();
  const [year, month] = today.split('-').map(Number);
  for (let index = 0; index < 12; index++) {
    const date = new Date(year, month - 1 + index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    months.set(key, { key, expected: 0, received: 0, overdue: 0, rows: [] });
  }
  for (const row of rows.filter(item => item.month !== 'undated')) {
    if (!months.has(row.month)) months.set(row.month, { key: row.month, expected: 0, received: 0, overdue: 0, rows: [] });
    const bucket = months.get(row.month);
    bucket[row.paid ? 'received' : 'expected'] += row.cents;
    if (row.overdue) bucket.overdue += row.cents;
    bucket.rows.push(row);
  }
  return {
    months: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)),
    undated: rows.filter(row => row.month === 'undated'),
    unstaged,
    overdue: rows.filter(row => row.overdue),
  };
}
