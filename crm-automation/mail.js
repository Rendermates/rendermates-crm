import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canEmail, nzDay, renderTemplate, ruleOccurrence, validEmail, validateRule } from './domain.js';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const recipient = job => String(job.email || job.clientEmail || '').trim().toLowerCase();
export const suppressionId = (email, kind) => `${hash(email.trim().toLowerCase())}_${kind}`;
export const deliveryId = (ruleId, jobId, occurrence) => hash(JSON.stringify([ruleId, jobId, occurrence]));
export function deliveryEligible({ delivery, job, rule, enabled, suppressed = false, now = Date.now() }) {
  if (!enabled || suppressed || !job || !rule || !delivery) return false;
  try { validateRule(rule); } catch { return false; }
  const age = now - Date.parse(delivery.createdAt);
  if (!Number.isFinite(age) || age < -300000 || age > 48 * 3600000) return false;
  if (!rule.enabled || delivery.kind !== rule.kind || !canEmail(job, rule.kind) ||
      hash(recipient(job)) !== delivery.recipientHash) return false;
  return rule.trigger === 'status' ? rule.status === job.status :
    ruleOccurrence(rule, job, nzDay(new Date(now))) === delivery.occurrence;
}
export function unsubscribeToken(payload, secret) {
  if (!secret || secret.length < 32) throw new Error('Unsubscribe signing secret is not configured.');
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}
export function verifyUnsubscribe(token, secret, now = Date.now()) {
  if (!secret || secret.length < 32 || typeof token !== 'string' || token.length > 3000) return null;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return null;
  const expected = createHmac('sha256', secret).update(encoded).digest();
  let supplied, payload;
  try {
    supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch { return null; }
  return /^[A-Za-z0-9_-]{1,200}$/.test(payload.jobId || '') &&
    ['maintenance', 'marketing', 'follow_up'].includes(payload.kind) &&
    /^[a-f0-9]{64}$/.test(payload.emailHash || '') &&
    Number.isFinite(payload.expires) && payload.expires > now ? payload : null;
}
export function buildEmail({ rule, job, jobId, from, unsubscribeUrl, secret, id, now = Date.now() }) {
  if (!canEmail(job, rule.kind) || !validEmail(from)) throw new Error('Invalid or unconsented recipient/sender.');
  const url = new URL(unsubscribeUrl);
  if (url.protocol !== 'https:') throw new Error('Unsubscribe URL must be HTTPS.');
  url.searchParams.set('token', unsubscribeToken({
    jobId, kind: rule.kind, emailHash: hash(recipient(job)), expires: now + 5 * 365 * 86400000
  }, secret));
  const subject = renderTemplate(rule.subject, job);
  const text = `${renderTemplate(rule.body, job)}\n\nRendermates\nYou received this ${rule.kind.replace('_', ' ')} email because permission was recorded.\nManage this email preference / unsubscribe: ${url.href}`;
  // Encode non-ASCII subjects; strict addresses prevent injected headers/extra recipients.
  const lines = [
    `From: Rendermates <${from}>`, `To: ${recipient(job)}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `Message-ID: <${id}@rendermates.co.nz>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', `List-Unsubscribe: <${url.href}>`, '',
    Buffer.from(text).toString('base64').match(/.{1,76}/g).join('\r\n')
  ];
  return { raw: Buffer.from(lines.join('\r\n')).toString('base64url') };
}

export async function sendGmail(auth, message, fetcher = fetch) {
  if (!validEmail(auth.sender) || !auth.clientId || !auth.clientSecret || !auth.refreshToken) throw new Error('Sender configuration is incomplete.');
  const tokenResponse = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: auth.clientId, client_secret: auth.clientSecret, refresh_token: auth.refreshToken })
  });
  if (!tokenResponse.ok) throw new Error('Sender authorization failed before dispatch.');
  const token = await tokenResponse.json();
  if (!token.access_token) throw new Error('Sender authorization did not return a token.');
  const response = await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });
  // Do not log/return OAuth credentials or provider response bodies.
  if (!response.ok) throw new Error('Provider rejected dispatch; review before retrying.');
  const sent = await response.json();
  if (!sent.id) throw new Error('Provider acceptance is uncertain; do not retry automatically.');
  return sent.id;
}
