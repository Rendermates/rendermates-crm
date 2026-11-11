import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { canEmail, nzDay, ruleOccurrence, validateRule, WON_STATUSES } from './domain.js';
import { buildEmail, deliveryEligible, deliveryId, hash, recipient, sendGmail, suppressionId, verifyUnsubscribe } from './mail.js';

const app = getApps().find(app => app.name === '[DEFAULT]') || initializeApp();
setGlobalOptions({ serviceAccount: 'crm-automation-runtime@rendermates-crm.iam.gserviceaccount.com' });
const db = getFirestore(app);
const senderAuth = defineSecret('CRM_GMAIL_SENDER_AUTH');
const unsubscribeSecret = defineSecret('CRM_UNSUBSCRIBE_SECRET');
const region = 'australia-southeast1';
const controlRef = () => db.doc('_crmAutomationControl/email');
const nowISO = () => new Date().toISOString();

async function enqueue(ruleDoc, jobDoc, occurrence) {
  const rule = ruleDoc.data(), job = jobDoc.data();
  try { validateRule(rule); } catch { return; }
  if (!rule.enabled || !canEmail(job, rule.kind)) return;
  const control = await controlRef().get();
  const suppression = await db.doc(`_crmEmailSuppressions/${suppressionId(recipient(job), rule.kind)}`).get();
  if (suppression.exists) return;
  const ref = db.doc(`crmEmailOutbox/${deliveryId(ruleDoc.id, jobDoc.id, occurrence)}`);
  try {
    await ref.create({
      jobId: jobDoc.id, ruleId: ruleDoc.id, ruleName: rule.name, recipientHash: hash(recipient(job)),
      occurrence, kind: rule.kind, createdAt: nowISO(), status: control.data()?.enabled === true ? 'pending' : 'dry_run'
    });
  } catch (error) { if (error.code !== 6 && error.code !== 'already-exists') throw error; }
}

export const crmCustomerEvents = onDocumentWritten({
  document: 'jobs/{jobId}', region: 'australia-southeast2', maxInstances: 2, retry: true
}, async event => {
  if (!event.data?.after.exists) return;
  const job = event.data.after.data(), before = event.data.before.data() || {};
  const ref = event.data.after.ref;
  const text = job.message || job.enquiryMessage || job.websiteMessage;
  const oldText = before.message || before.enquiryMessage || before.websiteMessage;
  if (text && text !== oldText) {
    try {
      await ref.collection('messages').doc(hash(`incoming:${event.id}`)).create({
        direction: 'incoming', source: job.source || 'website', text: String(text).slice(0, 20000),
        createdAt: event.data.before.exists ? event.time : job.createdAt?.toDate?.().toISOString() || event.time
      });
    } catch (error) { if (error.code !== 6 && error.code !== 'already-exists') throw error; }
  }
  if (job.status !== before.status) {
    try {
      await ref.collection('activity').doc(hash(event.id)).create({
        type: 'status_backend', actor: 'CRM backend',
        text: `Sales stage recorded: ${before.status || 'new'} → ${job.status || 'lead'}.${job.status === 'lost' ? ` Loss: ${job.lossReason || 'not recorded'}. ${job.lossNotes || ''}` : ''}`,
        createdAt: event.time
      });
    } catch (error) { if (error.code !== 6 && error.code !== 'already-exists') throw error; }
    // Historical wins are intentionally not backdated or inferred from deployment.
    if (event.data.before.exists && WON_STATUSES.includes(job.status) && !job.closedWonAt && !WON_STATUSES.includes(before.status)) {
      await db.runTransaction(async transaction => {
        const current = await transaction.get(ref);
        if (current.exists && !current.data().closedWonAt && WON_STATUSES.includes(current.data().status)) {
          transaction.update(ref, { closedWonAt: event.time });
        }
      });
    }
    const rules = await db.collection('crmEmailRules').where('trigger', '==', 'status').get();
    for (const rule of rules.docs) {
      if (rule.data().status === job.status) await enqueue(rule, event.data.after, `status:${event.id}`);
    }
  }
});

export const crmQueueEmails = onSchedule({ schedule: 'every 15 minutes', timeZone: 'Pacific/Auckland', region, maxInstances: 1 }, async () => {
  const rules = await db.collection('crmEmailRules').where('enabled', '==', true).get();
  const day = nzDay();
  let cursor;
  do {
    let query = db.collection('jobs').orderBy('__name__').limit(200);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const job of page.docs) for (const rule of rules.docs) {
      try { validateRule(rule.data()); } catch { continue; }
      const occurrence = ruleOccurrence(rule.data(), job.data(), day);
      if (occurrence) await enqueue(rule, job, occurrence);
    }
    cursor = page.size === 200 ? page.docs.at(-1) : null;
  } while (cursor);
});

export const crmSendEmails = onSchedule({
  schedule: 'every 5 minutes', timeZone: 'Pacific/Auckland', region, maxInstances: 1,
  secrets: [senderAuth, unsubscribeSecret]
}, async () => {
  if ((await controlRef().get()).data()?.enabled !== true) return;
  const auth = JSON.parse(senderAuth.value());
  const project = app.options.projectId || process.env.GCLOUD_PROJECT;
  if (project !== 'rendermates-crm') throw new Error('Unexpected CRM project.');
  const unsubscribeUrl = `https://${region}-${project}.cloudfunctions.net/crmUnsubscribe`;
  // A stale in-flight item is ambiguous: never auto-resend a possibly accepted message.
  const stale = await db.collection('crmEmailOutbox').where('status', '==', 'sending').limit(100).get();
  for (const item of stale.docs) if (Date.parse(item.data().claimedAt) < Date.now() - 600000) {
    await item.ref.update({ status: 'needs_review', reason: 'Delivery interrupted; acceptance uncertain.' });
  }
  const pending = await db.collection('crmEmailOutbox').where('status', '==', 'pending').limit(25).get();
  for (const item of pending.docs) {
    const claimed = await db.runTransaction(async transaction => {
      const current = await transaction.get(item.ref);
      if (current.data()?.status !== 'pending') return null;
      const data = current.data();
      const [jobDoc, ruleDoc, control] = await Promise.all([
        transaction.get(db.doc(`jobs/${data.jobId}`)), transaction.get(db.doc(`crmEmailRules/${data.ruleId}`)), transaction.get(controlRef())
      ]);
      const job = jobDoc.data(), rule = ruleDoc.data();
      const suppression = job && await transaction.get(db.doc(`_crmEmailSuppressions/${suppressionId(recipient(job), data.kind)}`));
      if (!deliveryEligible({ delivery: data, job, rule, enabled: control.data()?.enabled === true, suppressed: suppression?.exists })) {
        transaction.update(item.ref, { status: 'cancelled', reason: 'Recipient, rule, consent or control changed.' });
        return null;
      }
      transaction.update(item.ref, { status: 'sending', claimedAt: nowISO() });
      return { job, rule, data };
    });
    if (!claimed) continue;
    try {
      // Recheck opt-out immediately before dispatch, after claiming.
      const [freshDoc, ruleDoc, control, suppressed] = await Promise.all([
        db.doc(`jobs/${claimed.data.jobId}`).get(), db.doc(`crmEmailRules/${claimed.data.ruleId}`).get(), controlRef().get(),
        db.doc(`_crmEmailSuppressions/${suppressionId(recipient(claimed.job), claimed.data.kind)}`).get()
      ]);
      const fresh = freshDoc.data(), freshRule = ruleDoc.data();
      if (!deliveryEligible({ delivery: claimed.data, job: fresh, rule: freshRule, enabled: control.data()?.enabled === true, suppressed: suppressed.exists })) {
        await item.ref.update({ status: 'cancelled', reason: 'Consent or recipient changed before dispatch.' }); continue;
      }
      const message = buildEmail({
        rule: freshRule, job: fresh, jobId: claimed.data.jobId, id: item.id,
        from: auth.sender, unsubscribeUrl, secret: unsubscribeSecret.value()
      });
      const providerId = await sendGmail(auth, message);
      await item.ref.update({ status: 'sent', sentAt: nowISO(), providerId });
      await db.doc(`jobs/${claimed.data.jobId}`).collection('activity').add({
        type: 'email', text: `Automated email accepted by Gmail: ${freshRule.name}.`,
        actor: 'CRM backend', createdAt: nowISO()
      }).catch(() => {}); // An activity-log failure must never turn accepted mail into a retry.
    } catch {
      await item.ref.update({ status: 'needs_review', reason: 'Dispatch failed or acceptance uncertain. Review before any retry.' });
    }
  }
});

const html = message => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rendermates email preferences</title><body style="font:18px system-ui;max-width:600px;margin:60px auto;padding:24px"><h1>Rendermates email preferences</h1>${message}</body></html>`;
export const crmUnsubscribe = onRequest({
  region, invoker: 'public', maxInstances: 2, secrets: [unsubscribeSecret]
}, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  if (!['GET', 'POST'].includes(req.method)) { res.status(405).send('Method not allowed'); return; }
  const token = req.method === 'POST' ? req.body?.token : req.query.token;
  const verified = verifyUnsubscribe(token, unsubscribeSecret.value());
  if (!verified) { res.status(400).send(html('<p>This preference link is invalid or expired. Please contact Rendermates to opt out.</p>')); return; }
  if (req.method === 'GET') {
    // GET never changes preferences: email scanners follow links automatically.
    const safe = String(token).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    res.type('html').send(html(`<p>Stop ${verified.kind.replace('_', ' ')} emails to the address associated with this link?</p><form method="post"><input type="hidden" name="token" value="${safe}"><button type="submit">Unsubscribe</button></form>`)); return;
  }
  await db.runTransaction(async transaction => {
    const ref = db.doc(`jobs/${verified.jobId}`);
    const job = await transaction.get(ref);
    transaction.set(db.doc(`_crmEmailSuppressions/${verified.emailHash}_${verified.kind}`), { kind: verified.kind, createdAt: nowISO() });
    if (job.exists && hash(recipient(job.data())) === verified.emailHash) {
      transaction.update(ref, {
        [`contactPreferences.${verified.kind}`]: { optIn: false, source: 'Email unsubscribe', recordedAt: nowISO(), recordedBy: 'customer' }
      });
    }
  });
  res.type('html').send(html('<p>You have been unsubscribed from this email category. No login is required.</p>'));
});
