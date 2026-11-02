// Run in the administrator's authenticated Cloud Shell, not in the public app.
// No credentials are written to disk or printed. Default mode performs no writes.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const emails = JSON.parse(await readFile(new URL('./authorized-users.json', import.meta.url), 'utf8'));
const project = 'rendermates-crm';
if (!process.argv.includes('--apply')) {
  console.log(`Dry run: would approve ${emails.length} configured Google accounts in ${project}.`);
  console.log('No changes made. Review the list and rules, then use --apply only with approval.');
  process.exit(0);
}
let token;
try {
  token = execFileSync('gcloud', ['auth', 'print-access-token', '--project', project], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
} catch {
  // Do not dump the child-process Error object: it may contain captured output.
  console.error('Cloud Shell authorization could not be used. Reauthorize there and retry.');
  process.exit(1);
}
if (!token) throw new Error('Cloud Shell returned no authorization. No changes made.');
for (const email of emails) {
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/_crmAccess/${encodeURIComponent(email)}?updateMask.fieldPaths=enabled`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { enabled: { booleanValue: true } } })
  });
  if (!response.ok) throw new Error(`Approval write failed: HTTP ${response.status}. No credentials or response bodies logged.`);
}
console.log(`Approved ${emails.length} configured accounts. No jobs or calendar events were modified.`);
