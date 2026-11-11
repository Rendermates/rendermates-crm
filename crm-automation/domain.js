// Pure shared domain logic. No credentials, SDKs or production side effects.
export const ROLES = ['admin', 'manager', 'sales'];
export const OWNER_EMAILS = ['info@rendermates.co.nz', 'rendermatesnz@gmail.com'];
export const STATUSES = ['lead', 'site_visit', 'quoted', 'booked', 'in_progress', 'completed', 'lost'];
export const LOSS_REASONS = ['Price', 'Budget', 'Timing', 'Competitor', 'No response', 'Outside service area', 'Other'];
export const WON_STATUSES = ['booked', 'in_progress', 'completed'];
export const ADDRESS_FIELDS = ['street', 'unit', 'neighborhood', 'city', 'region', 'postalCode', 'country'];
export const EMAIL_KINDS = ['maintenance', 'marketing', 'follow_up'];
export const validEmail = value => typeof value === 'string' &&
  value.length <= 320 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(value);

export function membershipRole(email, membership) {
  if (membership?.enabled !== true) return null;
  if (Object.hasOwn(membership, 'role')) return ROLES.includes(membership.role) ? membership.role : null;
  return OWNER_EMAILS.includes(email) ? 'admin' : null;
}
export const manages = role => role === 'admin' || role === 'manager';
export function millis(value) {
  if (!value) return null;
  const ms = typeof value?.toMillis === 'function' ? value.toMillis()
    : typeof value?.seconds === 'number' ? value.seconds * 1000
      : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
export function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function nzDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function addMonths(day, count) {
  if (!validDay(day) || !Number.isInteger(count) || count < 0 || count > 120) return null;
  const date = new Date(`${day}T00:00:00Z`);
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(date.getUTCDate(), last));
  return first.toISOString().slice(0, 10);
}
export function formatAddress(details, legacy = '') {
  if (!details || !Object.values(details).some(Boolean)) return legacy;
  return [details.unit && `Unit ${details.unit}`, details.street, details.neighborhood,
    details.city, details.region, details.postalCode, details.country].filter(Boolean).join(', ');
}
export function stagePatch(job, status, loss = {}, now = new Date().toISOString()) {
  if (!STATUSES.includes(status)) throw new Error('Choose a valid sales stage.');
  const patch = { status };
  if (status === 'lost') {
    if (!LOSS_REASONS.includes(loss.lossReason)) throw new Error('Choose a loss reason.');
    if (loss.lossReason === 'Other' && !loss.lossNotes?.trim()) throw new Error('Explain the loss reason.');
    patch.lossReason = loss.lossReason;
    patch.lossNotes = String(loss.lossNotes || '').trim().slice(0, 4000);
    if (job.status !== 'lost') patch.closedLostAt = now;
  }
  if (WON_STATUSES.includes(status) && !job.closedWonAt && !WON_STATUSES.includes(job.status)) patch.closedWonAt = now;
  return patch;
}
export function profilePatch(job, draft, actor, now = new Date().toISOString()) {
  const text = key => String(draft[key] || '').trim();
  if (!text('clientName')) throw new Error('Customer name is required.');
  if (text('email') && !validEmail(text('email'))) throw new Error('Enter a valid email.');
  const addressDetails = Object.fromEntries(ADDRESS_FIELDS.map(key => [key, String(draft.addressDetails?.[key] || '').trim().slice(0, 500)]));
  const patch = {
    clientName: text('clientName').slice(0, 300), email: text('email').toLowerCase(),
    phone: text('phone').slice(0, 100), customerNotes: text('customerNotes').slice(0, 10000),
    addressDetails, address: formatAddress(addressDetails, text('address')).slice(0, 2000),
    lastPurchaseDate: text('lastPurchaseDate'), nextFollowUpDate: text('nextFollowUpDate'), updatedAt: now,
    ...stagePatch(job, draft.status || 'lead', draft, now)
  };
  if (patch.lastPurchaseDate && !validDay(patch.lastPurchaseDate)) throw new Error('Enter a valid last purchase date.');
  if (patch.nextFollowUpDate && !validDay(patch.nextFollowUpDate)) throw new Error('Enter a valid follow-up date.');
  if (Object.hasOwn(job, 'clientEmail')) patch.clientEmail = patch.email;
  const preferences = {};
  for (const kind of EMAIL_KINDS) {
    const old = job.contactPreferences?.[kind] || {};
    const emailChanged = patch.email !== String(job.email || job.clientEmail || '').toLowerCase();
    const enabled = !emailChanged && draft.contactPreferences?.[kind]?.optIn === true;
    const basis = String(draft.contactPreferences?.[kind]?.source || '').trim().slice(0, 1000);
    if (enabled && !basis) throw new Error(`Record the consent source for ${kind}.`);
    preferences[kind] = enabled === (old.optIn === true) && basis === (old.source || '') ? old
      : { optIn: enabled, source: basis, recordedAt: now, recordedBy: actor };
  }
  patch.contactPreferences = preferences;
  return patch;
}
export function analytics(jobs, now = new Date()) {
  const records = jobs.filter(j => !j.isTest && !/^TESTE INTEGRACAO CRM|^CRM SYNC TEST|^FICTIONAL\b/i.test(j.clientName || ''));
  const won = records.filter(j => WON_STATUSES.includes(j.status) || millis(j.closedWonAt) !== null);
  const cycles = won.map(j => {
    const start = millis(j.createdAt), end = millis(j.closedWonAt);
    return start !== null && end !== null && end >= start ? (end - start) / 86400000 : null;
  }).filter(n => n !== null);
  const losses = LOSS_REASONS.map(reason => ({ reason, count: records.filter(j => j.status === 'lost' && j.lossReason === reason).length }))
    .filter(row => row.count).sort((a, b) => b.count - a.count);
  const month = nzDay(now).slice(0, 7);
  const [year, number] = month.split('-').map(Number);
  const volume = Array.from({ length: 6 }, (_, i) => {
    const key = new Date(Date.UTC(year, number - 6 + i, 1)).toISOString().slice(0, 7);
    return { month: key, count: records.filter(j => {
      const stamp = millis(j.createdAt);
      return stamp !== null && nzDay(new Date(stamp)).slice(0, 7) === key;
    }).length };
  });
  return {
    total: records.length, won: won.length, conversion: records.length ? won.length / records.length * 100 : 0,
    cycleDays: cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : null,
    cycleSamples: cycles.length, missingCycles: won.length - cycles.length, losses, volume,
    excluded: jobs.length - records.length
  };
}
export function canEmail(job, kind) {
  return EMAIL_KINDS.includes(kind) && !job.archived && !job.archivedAt &&
    validEmail(job.email || job.clientEmail || '') &&
    job.contactPreferences?.[kind]?.optIn === true &&
    typeof job.contactPreferences?.[kind]?.source === 'string' && job.contactPreferences[kind].source.trim().length > 0;
}
export function validateRule(rule) {
  if (!EMAIL_KINDS.includes(rule.kind) || !['maintenance', 'annual', 'status', 'follow_up'].includes(rule.trigger)) throw new Error('Invalid email rule.');
  if (!rule.name?.trim() || !rule.subject?.trim() || !rule.body?.trim()) throw new Error('Name, subject and message are required.');
  if (rule.subject.length > 300 || rule.body.length > 20000 || /[\r\n]/.test(rule.subject)) throw new Error('Invalid message length or subject.');
  if (rule.trigger === 'maintenance' && (!Number.isInteger(rule.months) || rule.months < 1 || rule.months > 120)) throw new Error('Maintenance interval must be 1–120 months.');
  if (rule.trigger === 'annual' && !validDay(`2000-${rule.monthDay}`)) throw new Error('Choose a valid annual date.');
  if (rule.trigger === 'status' && !STATUSES.includes(rule.status)) throw new Error('Choose the triggering sales stage.');
  return rule;
}
export function ruleOccurrence(rule, job, day) {
  if (!validDay(day) || !rule.enabled || !canEmail(job, rule.kind)) return null;
  if (rule.trigger === 'maintenance') {
    const due = addMonths(job.lastPurchaseDate, rule.months);
    return due === day ? due : null;
  }
  if (rule.trigger === 'annual') return day.slice(5) === rule.monthDay ? day : null;
  if (rule.trigger === 'follow_up') return validDay(job.nextFollowUpDate) && job.nextFollowUpDate === day ? day : null;
  return null;
}
export function renderTemplate(text, job) {
  const values = { name: job.clientName || job.name || 'there', address: job.address || '', company: 'Rendermates' };
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? ''));
}
