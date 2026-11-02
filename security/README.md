# CRM access control — deploy separately from calendar synchronization

## Scope and current status

Prepared for review, **not deployed**. The current production Firestore rules,
shown by the administrator, allow unauthenticated access until 2026-11-15.
Do not describe production as protected until the real rules and OAuth flow
have been verified. Do not extend that test-mode date.

This is an independent security PR based on `main`; it does not require the
unmerged calendar backend. It changes no customer jobs and no marketing site.
Keep calendar synchronization disabled throughout this rollout.

## Access boundary

- Firebase Authentication with Google is required, with a verified email.
- The exact two accounts confirmed by the owner are in `authorized-users.json`
  and the rules. Being signed in, having another Google account, or editing the
  JavaScript bundle is not sufficient.
- Each allowed email also needs an administrative `_crmAccess/{email}` document
  with `enabled: true`. Only the server/console can write approvals. Users may
  get their own approval, not list approvals or read another user's record.
- The browser waits for a server-confirmed approval snapshot before mounting
  the workspace; offline cache and pending local writes never authorize access.
  Revocation unmounts it; sign-out unmounts immediately and detaches listeners.
- Authorized users can access jobs. Client writes cannot forge `calendarSync`.
  Private sync controls/baselines and all unspecified collections are denied.
- Admin SDK/IAM identities bypass client rules; the website intake and calendar
  backend must continue to use their reviewed server identities, never a public
  client write. Their real deployed behavior still needs verification.

## Tests (isolated, never point at the production project)

Node 24.12+ and Java 21+ are required for this version of the emulator test tools:

```sh
npm --prefix security ci
npm --prefix security test
node --test test/*.test.js
npm run build
```

The suite uses **demo-rendermates-crm**, Firestore on `127.0.0.1:8088`,
mocked auth claims and fictional jobs. No Google login, production writes or
website emails are performed. Browser preview uses separate untracked mock
modules; no bypass is included in the production build.

The test-only dependency tree overrides the SDK's old gRPC range to a patched
compatible 1.x release. Emulator/CLI tools are isolated from frontend production
dependencies. Review audit results separately; passing access tests is not a
claim that the entire toolchain has no dependency advisories.

At implementation verification, `npm audit` for the isolated test tools reported
15 moderate advisories and no high/critical advisories after that patch and
compatible audit fixes. No production dependencies or their lockfile changed.

## Controlled rollout — no automatic publication

1. Back up the existing Firestore rules. Confirm project `rendermates-crm`,
   Melbourne database, approval list and real authorized users.
2. In Firebase Authentication, enable the Google sign-in provider. Choose the
   project's appropriate support email. Add the exact CRM host
   `rendermates-crm.vercel.app` under authorized domains. A live preview test
   needs its own exact Vercel preview hostname authorized too; do not authorize
   arbitrary third-party hosts.
3. Authenticate as an approved Google account in the new Vercel preview and
   confirm the identity under Firebase Authentication > Users. It will not be
   admitted into the workspace yet; no approval read is server-authorized under
   the new policy until the next steps are complete.
4. Review the provisioning script. Its default invocation is a dry run:

   ```sh
   node security/provision-access.mjs
   ```

   Only after explicit approval, run in the administrator's authenticated
   Cloud Shell:

   ```sh
   node security/provision-access.mjs --apply
   ```

   It uses the existing `gcloud` login in memory, never prints/writes tokens,
   and sets only `enabled` on the two configured approval documents. It does
   not edit jobs, original dates, money, extras or Google events. Keep the
   window between provisioning and protected rules short; the old public
   wildcard must not remain in place.
5. After explicit publication approval, deploy the new frontend and replace
   the **entire old rules text** with the reviewed `firestore.rules` in the
   Firebase console, then publish. Do not append a deny to the old wildcard:
   overlapping Firestore matches are OR, not deny-overrides. Do not deploy
   Firebase functions, marketing hosting or unrelated rules.
6. Verify actual protected rules: no-login clients are denied; each approved
   real Google account can access; an unapproved account cannot; signing out
   removes CRM data. Review and test one clearly fictional job, including its
   existing claims/extras and normal date/archival updates.
7. Verify the real website server still creates a fictional lead with explicit
   approval for any email/notification side effects. Emulator Admin SDK tests
   do not establish the deployed website identity or successful delivery.
8. Only then resume the disabled calendar integration rollout.

## Operational cautions

- Before activation, a person with the old frontend may briefly get permission
  errors when the rules are published; refresh into the new login version.
  Verify the owner can sign in before changing rules; do not publish a login
  requirement blind and assume existing sessions are authenticated.
- A missing or disabled approval is fail-closed. To revoke, set `enabled: false`
  with the console/Admin SDK. To add an account, review both the fixed identity
  list and the administrative approval; a forged approval for another address
  alone cannot authorize it.
- `info@rendermates.co.nz` must be a Google identity, not merely a forwarding
  alias. The sign-in token's verified email is what counts.
- If rollout fails, do **not** restore public test-mode access or erase data.
  Keep protected rules, repair the provider/domain/approved identity, and use
  the trusted administrative console for recovery. Roll back UI only to a
  version with the same login boundary.
