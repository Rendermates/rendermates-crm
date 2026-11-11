# CRM sales and customer upgrade

## Scope and five implementation phases

1. **Customer profiles and conversation history:** the new Sales & Customers workspace edits customer name, email, phone, plain-text address, notes and stage. Structured address fields are optional and never depend on mapping APIs. Original website messages remain visible. Additional incoming conversations can be logged manually. New website-message changes are captured by the backend after deployment. Same-email history is combined only across records the signed-in person can access.
2. **Sales follow-ups and lost deals:** timestamped tasks with editable title/assignee/due time, completion/reopening, global overdue alerts and optional browser notifications. The Lost stage requires a standard reason; Other also requires explanation, retained in the append-only activity history. Existing job/quote/payment workflows remain available.
3. **KPI reporting:** recorded leads, lead-to-win conversion, average first-win cycle, ranked loss reasons and six Wellington calendar months of incoming lead volume. Charts use a zero baseline. Metrics include archived deals, exclude explicitly identified tests, disclose missing dates and never manufacture historical purchase/win dates.
4. **Team access and consent:** Google identity plus server-approved membership; admin/manager see team data and analytics, sales see only assigned leads/tasks. No client can grant roles, assign itself somebody else's lead, forge calendar sync metadata, or write delivery state. Existing owner memberships retain access. Consent is separate for maintenance, marketing and follow-ups; nobody is automatically opted in.
5. **Email automation backend:** maintenance X months after a recorded purchase, annual/Christmas dates, a stage change, and explicit follow-up dates. Gmail OAuth or verified-TLS business SMTP transport, deterministic outbox IDs, a server-only sending gate, signed confirmation-based unsubscribe and category-wide suppression. Rule editing alone cannot activate the sender.

These phases are implemented as code, not a claim that production has been upgraded. Publication, backend deployment, service identity review and sender activation remain separate, explicitly approved operations.

## Data model (additive, existing records preserved)

`jobs/{id}` remains the existing deal/customer-file record. This avoids a risky bulk migration of live jobs, claims or calendar events. Repeat enquiries are not silently merged or deleted. The UI combines readable message history for matching non-empty email addresses within the viewer's access scope; profile edits apply only to the selected deal. A standalone deduplicated master-customer database is not introduced.

| Field | Type and purpose |
|---|---|
| `clientName`, `email`, `phone`, `status` | Editable contact and sales stage |
| `address` | Compatible formatted plain-text address |
| `addressDetails` | `street`, `unit`, `neighborhood`, `city`, `region`, `postalCode`, `country` strings |
| `customerNotes` | Free-text customer notes, separate from site-visit notes |
| `assignedTo` | Lowercase approved Google email; blank means managers only |
| `lastPurchaseDate` | Explicit `YYYY-MM-DD`; not inferred from a calendar booking or invoice |
| `nextFollowUpDate` | Explicit Wellington calendar date |
| `closedWonAt`, `closedLostAt` | Recorded transition times; old missing win dates stay unknown |
| `lossReason`, `lossNotes` | Controlled reason; mandatory explanation for Other |
| `contactPreferences.{maintenance,marketing,follow_up}` | `optIn`, `source`, `recordedAt`, `recordedBy` |
| `crmVersion` | Transaction conflict check for profile/stage editing |

Changing the recipient email resets consent. To opt the new address in, reopen the profile and record permission. A signed unsubscribe also adds a server-owned suppression for that normalized address and category, across all its deal records. A later checkbox edit does **not** clear this suppression; an administrator must review genuinely renewed consent before removing it.

Financial `claims`, `extras`, contract values, work dates, attachments, website source and `calendarSync` are not replaced by customer editing. Transactions compare the original profile fields and version to detect intervening edits; unrelated financial updates are preserved.

| Collection | Contents and ownership |
|---|---|
| `jobs/{id}/messages/{id}` | Incoming website text or clearly marked manual incoming/team entries; append-only in browser |
| `jobs/{id}/activity/{id}` | Profile/stage changes and backend delivery records; append-only |
| `crmTasks/{id}` | `title`, `jobId`, `assignedTo`, UTC `dueAt`, `status`, `createdBy`, timestamps |
| `crmEmailRules/{id}` | Name, consent category, trigger, trigger parameters, subject/body, enabled flag |
| `crmEmailOutbox/{deterministicId}` | Job/rule references, recipient hash, occurrence, state and delivery timestamps; server writes only |
| `_crmAccess/{email}` | Enabled membership and `admin` / `manager` / `sales` role; server writes only |
| `_crmAutomationControl/email` | Global `enabled` flag, defaults OFF when absent; server writes only |
| `_crmEmailSuppressions/{emailHash_category}` | Unsubscribe suppression; server-only |

## Email safety and operational behavior

- The existing WordPress connector still creates `jobs` only. It does not receive broader permissions and is not replaced by this codebase. Uploaded photos remain in the original Elementor workflow, not automatically in CRM.
- The new Firebase codebase is **`crm-automation`**. Existing `calendar-sync` configuration remains separate. Do not delete old calendar functions or change active sync flags as part of this rollout.
- Scheduler evaluation runs every 15 minutes in Wellington time. Dispatch checks pending records every five minutes, at most 25 per run. Date rules use the current NZ calendar date and clamp month-end maintenance dates. They do not send a backlog for dates missed during an outage. Operators should review missed days explicitly instead of surprising customers with retroactive campaigns.
- When global sending is disabled, eligible occurrences are saved as `dry_run`, not future-sendable pending mail. Enabling the system does not replay these previews. If a dry run already consumed today's occurrence, that occurrence will not send automatically after activation.
- Consent, suppression, archive state, recipient identity and rule/control state are checked before claiming; recipient/consent/suppression are checked again immediately before sending. An already in-flight provider request cannot be recalled if permission changes concurrently.
- Deterministic occurrence IDs prevent scheduler/event retries from enqueueing duplicate messages. Items are transactionally claimed. Failures or stale claims become `needs_review`; there is **no blind automatic resend** after uncertain provider acceptance. This is not an exactly-once delivery guarantee.
- Provider acceptance is recorded, not proof of delivery to the inbox or opening. No tracking pixel or open-rate reporting is added. Business SMTP requires implicit TLS on port 465, certificate verification, an approved provider host, one recipient, and the authenticated mailbox as sender. SMTP errors are sanitized and never automatically retried.
- Unsubscribe GET shows a confirmation form; POST changes preferences, avoiding automatic opt-outs from security scanners. The HMAC token has an expiry, category and recipient hash. The public handler exposes no CRM lists or messages.
- Browser task notifications require permission and an open CRM tab. This implementation does not promise background push, mobile push or sales-rep reminder emails.
- Historical mailbox conversations are **not** imported. The timeline includes retained website enquiry text, manually logged conversations and future backend observations after deployment.
- Customer consent evidence, retention, lawful basis, sender identity and campaign content still need business/legal review. These technical controls alone do not certify GDPR/LGPD compliance. Erasure/export requests must cover job subcollections and related tasks/outbox as well as the parent record; deleting a Firestore parent alone does not erase subcollections.

## Approved rollout procedure (not performed by this change)

1. Review the PR and local/emulator evidence. Back up production Firestore and record existing calendar function identities/flags. Approve rule and backend publication separately from activating real email sending.
2. Deploy the reviewed Firestore rules. Existing enabled owner records remain admins without a migration. New teammates need an explicit role; an enabled outsider record without a role grants nothing.
3. In the owner's authenticated Cloud Shell, preview a membership change:
   `node security/provision-role.mjs --email teammate@example.com --role sales`
   Add `--apply` only after the owner approves that person and role. Disabling `_crmAccess/{email}.enabled` revokes access. Do not run the old owner provisioning helper to broaden team permissions.
4. Create the dedicated `crm-automation-runtime` service account required by this codebase's global runtime options. Its custom Firestore role needs `datastore.entities.get`, `datastore.entities.list`, `datastore.entities.create`, `datastore.entities.update`, and **`datastore.databases.get` for beginning/rolling back transactions**; that last permission is not the metadata-read permission. See the official [Firestore IAM method permissions](https://cloud.google.com/firestore/native/docs/security/iam). Grant access to its two secrets and any deployment-required runtime/logging permissions. No document deletion is needed. Do not reuse or broaden the website create-only identity, calendar writer, or a broad Firebase administrator. Verify the deployed runtime identity before enabling schedules. Firestore server IAM is not per-document client RBAC; review its database-wide scope. Budget for Firestore operations and scheduler/function usage.
5. Provision `CRM_EMAIL_SENDER_AUTH` through Secret Manager, never chat, source control or a client env file. Gmail OAuth uses JSON with `transport: "gmail_oauth"`, `clientId`, `clientSecret`, `refreshToken`, `sender` and dedicated Gmail send scope. Business SMTP uses `transport: "smtp"`, `host`, `port: 465`, `user`, `password`, `sender`; the sender must match the authenticated mailbox. Approved hosts are `smtp.gmail.com`, `smtp.hostinger.com`, and `smtp.titan.email`. For Google Workspace SMTP use a dedicated, revocable Google app password, not the user's normal login password. The conversation's Gmail integration does not automatically provide runtime credentials. Provision a separate strong `CRM_UNSUBSCRIBE_SECRET` through Secret Manager. No secret values belong in logs, screenshots or this document.
6. Deploy just `functions:crm-automation`, with those two secrets bound to the dispatch/opt-out handlers. Confirm all four new function names, schedulers and public HTTPS unsubscribe URL match this code. Leave `_crmAutomationControl/email.enabled` absent or false. The old Calendar codebase must not be republished as a side effect.
7. Publish the reviewed frontend through the existing GitHub/Vercel workflow. Verify each role with controlled test accounts and only fictional lead/task records. Assign existing leads selectively; no bulk ownership or purchase-date guessing is included.
8. Create a fictional opted-in record, prepare a disabled or dry-run rule and inspect an outbox preview. Test unsubscribe GET versus POST using fictional data. Before any real email test or activating the global switch, obtain explicit owner approval and verify the sender account, actual recipient, opt-out endpoint and no unexpected pending backlog. Never use real customers as test recipients without permission.
9. After approval, set the server-only gate to true and monitor `sent`, `cancelled`, `dry_run`, `needs_review`, function errors, scheduler execution and Gmail quota. For rollback, turn the gate OFF and pause the new schedulers first. Preserve the working website intake and calendar sync.

## Local validation

Install dependencies at the root and in `functions`, `crm-automation`, and `security` with `npm ci` in each directory. Use Node 22 for the app/runtime unit checks and Node 24 with Java 21 for Firebase security tooling.

`npm run build`, `npm run lint`, `node --test tests/*.test.js`, `npm --prefix functions test`, `npm --prefix crm-automation test`, and `npm --prefix security test`. The security suite also runs the real new backend handlers against an isolated demo-project emulator, including queue deduplication, unchanged money/calendar fields, disabled dispatch and GET/POST opt-out behavior. The GitHub validation workflow runs both groups without production credentials.

Use only demo-project Firestore emulators and fictional preview data. No real email, production database update, credential creation or deployment is required for these checks.
