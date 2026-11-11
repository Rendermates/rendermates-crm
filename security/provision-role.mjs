// Owner-run Cloud Shell helper. Dry-run by default; never prints OAuth credentials.
import { execFileSync } from 'node:child_process';
import { validEmail } from '../crm-automation/domain.js';
const args = process.argv.slice(2);
const option = key => args[args.indexOf(key) + 1] || '';
const email = args.includes('--email') ? option('--email').trim().toLowerCase() : '';
const role = args.includes('--role') ? option('--role') : '';
if (!validEmail(email) || !['admin', 'manager', 'sales'].includes(role)) {
  console.error('Usage: node security/provision-role.mjs --email user@example.com --role sales [--apply]');
  process.exit(1);
}
if (!args.includes('--apply')) {
  console.log(`Dry run: would enable ${email} with role ${role}. No data changed.`);
  process.exit(0);
}
let token;
try {
  token = execFileSync('gcloud', ['auth', 'print-access-token', '--project', 'rendermates-crm'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
} catch { console.error('Cloud Shell authorization unavailable. No changes made.'); process.exit(1); }
if (!token) { console.error('Authorization unavailable.'); process.exit(1); }
const response = await fetch(`https://firestore.googleapis.com/v1/projects/rendermates-crm/databases/(default)/documents/_crmAccess/${encodeURIComponent(email)}?updateMask.fieldPaths=enabled&updateMask.fieldPaths=role`, {
  method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { enabled: { booleanValue: true }, role: { stringValue: role } } })
});
if (!response.ok) { console.error(`Membership change failed: HTTP ${response.status}.`); process.exit(1); }
console.log('Membership updated. No customer, financial or calendar records were modified.');
