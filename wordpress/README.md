# Existing Elementor form → CRM New Leads

## Status and scope

Prepared implementation, **not installed or connected in production**. Installation,
identity provisioning and an explicitly authorized fictional live enquiry are still
required. Local PHP tests do not prove live Elementor compatibility or Google IAM
delivery. No changes to the authenticated Vercel frontend are required: it already
listens to `jobs` and displays website name, phone, email, address and message.

The public site's JavaScript was inspected on 2026-11-11. Its Atomic form submits
`elementor_pro_atomic_forms_send_form` to WordPress admin-ajax with post `5507`,
form `646e94a1`, and `form_fields` entries carrying `name`/`value`. This is **not**
the classic Elementor Pro form webhook hook. This connector observes only the
exact form's successful JSON response, after Elementor's own processing, without
changing the response, page, nonce validation, spam filtering, email actions or files.

If the live page, form ID, response shape or field names change, review/retest this
adapter. It must not capture unrelated forms or unsuccessful submissions.

## What reaches the CRM

- A new `jobs/website-<random UUID>` document with `status=lead`, `source=website`.
- `clientName`, `phone`, `email`, `address`, `message`, submission timestamp.
- No start/end dates, calendar metadata, money, extras or claims.
- **Photos/files are not copied to the CRM.** Existing Elementor file/email handling
  remains untouched; verify where it delivers attachments during the live test.
  If CRM photo access is required, add a separately reviewed private storage flow.

No frontend Firebase config, public write rules or CRM login bypass is introduced.
The WordPress server uses a separate create-only Google identity. IAM is scoped
to the database's document creation permission, not a collection restriction:
the key can create documents in other collections, but cannot read, update or
delete existing documents. The connector hard-codes only the `jobs` create endpoint.

## Install (WordPress administrator; Elementor editor not needed)

1. Take a hosting backup and review the plugin and dedicated identity permissions.
2. Zip the `rendermates-crm` directory in this folder. Upload it at WordPress
   **Plugins → Add New → Upload Plugin**, then activate it.
3. The plugin remains unconfigured and does not capture enquiries without credentials.
4. After explicit authorization, run the reviewed `provision-identity.sh --apply`
   in the owner's authenticated Cloud Shell. Its no-argument mode is a dry run.
   It creates a new service account/custom role and private key only. It does not
   deploy anything or touch the existing calendar identities, functions or jobs.
   Existing account/role causes a safe stop requiring review.
5. Download the generated JSON using Cloud Shell's download menu; upload the file
   **only** in WordPress **Settings → Rendermates CRM** over HTTPS. Never paste it in
   chat or store it under public_html. The original filename/content is not displayed.
   Remove local and Cloud Shell copies afterward. Only an administrator can configure.
6. Credentials are stored encrypted (AES-256-GCM) in a non-autoloaded WordPress option,
   using the site's auth salt. Backups remain sensitive; protect them and restrict
   WordPress admin access. Changing auth salts requires re-uploading the credential.
   Token transients, like normal WordPress server credentials, remain sensitive.
7. Keep WP-Cron enabled, or run the hosting's regular WordPress cron. Successful
   enquiries enter a durable, non-autoloaded database queue; delivery retries with
   backoff, up to hourly, without dropping failed enquiries. Default interval is
   five minutes, plus an immediate cron event. Cron depends on website visits unless
   a hosting cron is configured.
8. With explicit approval for email/notifications, submit **one fictional enquiry**
   through the actual website (including a small harmless attachment if desired).
   In Settings → Rendermates CRM, use **Send pending enquiries now** if needed.
   Confirm `delivered`, zero pending, and the same data in New Leads in the real CRM.
   Confirm original Elementor submission/email/attachment behavior still works.
   Archive the test lead through the normal CRM UI only with approval.

Do not buy a hosting upgrade or repair the editor to install this plugin. However,
existing 503/resource exhaustion can also prevent form submissions, cron or plugin
installation. This connector is not a hosting fix. If WordPress reports failure,
no lead is queued; keep the visible customer error/phone fallback intact.

## Reliability / security

- No network request is added to the visitor's submission response: delivery is cron.
- Each queued enquiry keeps the same UUID for every retry. `createDocument` cannot
  overwrite anything; a genuine `409 ALREADY_EXISTS` is treated as delivered.
- Failed deliveries remain queued. Administrators see generic status, not credentials,
  access tokens, upstream response bodies or customer details.
- Enquiries remain personal data in the WordPress queue until delivered. Include the
  queue in existing backup/privacy controls. No automatic retention purge loses leads.
- Deactivation stops cron but retains unsent enquiries and encrypted configuration.
  Revoke the dedicated key/role explicitly if retiring the integration; do not touch
  the calendar service accounts.
- No logging key, raw key, OAuth assertion or token is committed or printed.

## Local verification

```sh
php -l wordpress/rendermates-crm/rendermates-crm.php
php -l wordpress/rendermates-crm/src/connector.php
php wordpress/test/connector.test.php
bash -n wordpress/provision-identity.sh
bash wordpress/provision-identity.sh
```

These use only fictional data, a generated disposable local signing key, mocked
WordPress functions and a mocked HTTP transport. They do not contact Google,
send emails, mutate production or prove the production integration is active.
