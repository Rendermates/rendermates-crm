import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleIdentity, accessErrorMessage } from '../src/crm-access.js';

test('only verified Google identities produce an access-record key, not an authorization decision', () => {
  assert.equal(googleIdentity({
    email: 'STAFF@example.test', email_verified: true,
    firebase: { sign_in_provider: 'google.com' }
  }), 'staff@example.test');
  for (const claims of [
    null, {}, { email: 'staff@example.test', email_verified: true },
    { email: 'staff@example.test', email_verified: false, firebase: { sign_in_provider: 'google.com' } },
    { email: 'staff@example.test', email_verified: true, firebase: { sign_in_provider: 'password' } },
    { email: 123, email_verified: true, firebase: { sign_in_provider: 'google.com' } }
  ]) assert.equal(googleIdentity(claims), null);
});

test('authentication errors show safe actionable messages, never raw provider errors', () => {
  assert.match(accessErrorMessage('auth/popup-blocked'), /Allow pop-ups/);
  assert.match(accessErrorMessage('auth/unauthorized-domain'), /not been authorized/);
  assert.match(accessErrorMessage('auth/operation-not-allowed'), /not been enabled/);
  assert.match(accessErrorMessage('auth/popup-closed-by-user'), /cancelled/);
  assert.equal(accessErrorMessage('unknown private provider detail'), accessErrorMessage());
});
