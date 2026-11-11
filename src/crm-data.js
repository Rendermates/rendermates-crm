import { collection, doc, runTransaction } from 'firebase/firestore';
import { profilePatch, stagePatch } from '../crm-automation/domain';

const versionOf = job => job.crmVersion || 0;
const profileFields = ['clientName', 'name', 'email', 'clientEmail', 'phone', 'status', 'customerNotes', 'address',
  'addressDetails', 'assignedTo', 'contactPreferences', 'lastPurchaseDate', 'nextFollowUpDate', 'lossReason', 'lossNotes'];
const stable = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
const fingerprint = job => JSON.stringify(stable(Object.fromEntries(profileFields.map(key => [key, job[key] ?? null]))));
export async function saveCustomer(db, original, draft, actor, assignedTo) {
  const ref = doc(db, 'jobs', original.id);
  const activity = doc(collection(db, 'jobs', original.id, 'activity'));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('This customer record no longer exists.');
    const current = snapshot.data();
    if (versionOf(current) !== versionOf(original) || fingerprint(current) !== fingerprint(original)) throw new Error('This profile changed on another device. Close and reopen the editor before saving.');
    // Never replace the whole job: schedule, quotes, claims, extras and sync metadata survive.
    const patch = profilePatch(current, draft, actor);
    if (assignedTo !== undefined) patch.assignedTo = assignedTo.trim().toLowerCase();
    transaction.update(ref, { ...patch, crmVersion: versionOf(current) + 1 });
    transaction.set(activity, { type: 'profile', text: `Customer profile updated${current.status !== patch.status ? `: ${current.status || 'lead'} → ${patch.status}` : ''}.${patch.status === 'lost' ? ` Loss: ${patch.lossReason}. ${patch.lossNotes || ''}` : ''}`,
      actor, createdAt: new Date().toISOString() });
  });
}
export async function changeStage(db, job, status, loss, actor) {
  const ref = doc(db, 'jobs', job.id);
  const activity = doc(collection(db, 'jobs', job.id, 'activity'));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('This lead no longer exists.');
    const current = snapshot.data();
    const patch = stagePatch(current, status, loss);
    // Preserve the legacy stage-picker behavior without changing dates in profile editing.
    if (status === 'in_progress' && !current.startDate) patch.startDate = new Date().toISOString().split('T')[0];
    transaction.update(ref, { ...patch, crmVersion: versionOf(current) + 1 });
    transaction.set(activity, { type: 'status', text: `Sales stage: ${current.status || 'lead'} → ${status}${loss?.lossReason ? ` (${loss.lossReason})` : ''}.${loss?.lossNotes ? ` ${loss.lossNotes}` : ''}`,
      actor, createdAt: new Date().toISOString() });
  });
}
