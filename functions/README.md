# Rendermates two-way date synchronization

## Current status

Implemented and locally tested, **not deployed or enabled**. No live CRM
document has been changed by this implementation. Google already contains an
initial copy of 11 dated jobs from a separate, earlier migration.

This is a Firebase backend, not a Vercel API. Merging this PR or deploying the
Vite frontend **does not deploy or activate these functions**.

This PR is stacked on the Google-shortcuts PR. Merge the parent first.

## Behavior

- A Firestore `jobs/{jobId}` date change sends its current work period to Google.
- A scheduled pass runs every five minutes, importing changed Google dates and
  repairing missed outgoing updates. This version is **not Google webhook/push
  synchronization**: incoming Google changes can take roughly five minutes
  plus runtime/retry delays. Outgoing triggers are normally quicker.
- CRM dates are inclusive. Google all-day end dates are exclusive. Conversion
  uses UTC date arithmetic, not host timezone or daylight-saving offsets.
- Only single all-day **work-period** events are supported. Timed visits,
  recurrence, Tasks, personal-calendar events, titles edited in Google, and
  financial fields are not imported.
- IDs match the earlier migration: `c` plus the UTF-8 hexadecimal job ID. Event
  private properties must match `crmJobId` and `crmSource=rendermates-crm`.
- Existing imported events are adopted, never duplicated. A deleted known
  event is flagged, not recreated. A deleted CRM job is not deleted in Google.
  Archived work is left alone on both sides.
- Each job has a last-agreed date pair. If both sides diverge differently, the
  CRM shows an attention notice instead of selecting a winner.
- Firestore leases and transactions prevent overlapping workers from replacing
  newer CRM edits. Google PATCH uses `If-Match` with the event ETag.
- Google-to-CRM writes contain only `startDate`, `endDate` and the additive
  `calendarSync` status. Claims, extras, money, notes, contacts, status and
  archived state are never replaced.
- Transient failures are retried by the trigger and/or scheduled pass. Public
  CRM status shows attention/pending states; logs contain outcome codes only.
- Clean start/end editors refresh from live CRM snapshots. Unsaved drafts are
  preserved if remote dates change, with an explicit reload prompt and save
  disabled. Saving dates also checks the previously loaded date pair in a
  Firestore transaction so an edit cannot silently replace a newer schedule.
- Once a job has backend sync metadata, its legacy Google export shortcut
  opens the calendar instead of offering another event-creation template.

## Hosting and authorization prerequisites

1. Confirm the Firebase project is `rendermates-crm`. Confirm Blaze billing and
   the Firestore location before deploying. Cloud Functions, Eventarc, Cloud
   Scheduler, Cloud Build, Artifact Registry and IAM Credentials APIs must be
   available; review their costs and set budget alerts. Functions use
   `australia-southeast1`; change before initial deployment if necessary for
   the actual Firestore region. Do not move or recreate the existing database.
2. Use a reviewed deployment identity with permission to deploy functions,
   configure their service accounts and create the scheduler/trigger resources.
   This sandbox currently has **no authenticated gcloud/Firebase deployment
   account**. Google Calendar connector access is not Firebase IAM access.
   Authorize through the official CLI/browser flow in the deployment
   environment. Never paste credentials, OAuth codes or service-account keys
   into chat or commit them.
3. Provision dedicated identities:
   - Runtime: `crm-calendar-sync@rendermates-crm.iam.gserviceaccount.com`.
     Grant the needed Firestore data access and trigger invocation permissions
     for this deployment. Do not grant Owner/Editor as a shortcut.
   - Calendar writer: `crm-calendar-writer@rendermates-crm.iam.gserviceaccount.com`.
     No Firestore or broad project role. The runtime may impersonate **only this
     service account** using `roles/iam.serviceAccountTokenCreator` on that
     account. Google Calendar API must be enabled for the quota project.
   - Share only the existing **Rendermates Jobs** calendar with the writer as
     `writer`, not owner. Do not share the primary/personal calendar.
4. The backend uses Application Default Credentials plus scoped IAM
   impersonation. No downloaded private keys or browser-visible access tokens.
5. Review the **existing** Firestore security rules. Client SDKs must not read
   or write `_calendarSyncState` or `_calendarSyncControl`. Explicitly disallow
   them in the real rules and remove/constrain any broader wildcard that would
   grant access: Firestore overlapping matches use OR, so a deny rule alone
   does not override a permissive wildcard. Preserve the application's required
   job access. This repository intentionally does not deploy replacement rules
   or change existing user authentication.
6. Verify the schedule trigger's invoker configuration is private and the
   Eventarc/service agents have their documented least-privilege permissions.
   There is no public unauthenticated HTTP synchronization endpoint.

## Controlled activation

Do not enable production jobs simply because the local tests pass.

1. Install the backend separately with Node 22: `npm --prefix functions ci`.
   Run `npm --prefix functions test` and the existing root tests/build.
2. Copy `.env.example` to the ignored `functions/.env.rendermates-crm`.
   Set the ID of the **already-created** Rendermates Jobs calendar and the writer
   identity. Keep `CALENDAR_SYNC_ENABLED=false`, `CALENDAR_SYNC_JOB_IDS=` empty.
   These are non-secret configuration values.
3. After explicit deployment approval, deploy only the new functions:

   ```sh
   firebase deploy --project rendermates-crm --only functions:calendar-sync
   ```

   This must not deploy hosting, overwrite Firestore rules, modify unrelated
   functions, or replace the marketing website. Disabled triggers do no syncing.
4. Confirm real permissions and reviewed rules. Initialize the baselines **once
   while synchronization is disabled** with an authorized ADC identity that
   can impersonate the calendar writer:

   ```sh
   cd functions
   CONFIRM_CALENDAR_BOOTSTRAP=yes \
     node --env-file=.env.rendermates-crm bootstrap.js
   ```

   Bootstrap reads Google, never writes it, and never changes existing job
   dates. It adds sync metadata/status only. Missing known events and initial
   date mismatches are flagged for review. Reruns after initialization are
   refused so a live baseline cannot accidentally be reset.
5. Create one clearly marked fictitious pilot job with no real customer email.
   Enable **only its exact document ID** in `CALENDAR_SYNC_JOB_IDS`; set
   `CALENDAR_SYNC_ENABLED=true` and redeploy these functions. No `*` yet.
6. Observe both directions: CRM dates to Google, Google dates back within the
   polling interval, inclusive end date, replays without duplicates, and
   payments/extras unchanged. Test an intentional simultaneous conflict and
   deletion of the pilot event: both should flag attention without deleting or
   recreating the job/event. Do not use a real customer job for this test.
7. After successful pilot verification and approval, set
   `CALENDAR_SYNC_JOB_IDS=*` and redeploy. Review existing attention notices
   individually. Do not overwrite conflicting dates in bulk.
8. Keep the pilot evidence and check Cloud Logging for sanitized errors,
   Scheduler execution and permission failures. Budget for Firestore reads/
   writes and Google API quota; the initial scale is a dozen jobs.

## Conflict recovery and rollback

- Compare the work's dates on both sides. Set both to the agreed dates;
  reconciliation will adopt that pair and clear the notice.
- Restore a deleted Google event if it should remain linked. Known deleted
  events are not automatically recreated or replaced with a new ID.
- To stop new synchronization, set `CALENDAR_SYNC_ENABLED=false` and redeploy,
  then verify the disabled revision is serving. An already-running invocation
  may finish; wait for it before manually repairing any dates.
- Leave all CRM records, imported events and baselines intact. Do not bulk
  delete events, reset the baseline collection, or delete the customer database.
- Re-enabling with preserved baselines detects intervening conflicting edits.

## Verification scope

Node 22 unit tests use an in-memory transactional Firestore fixture and mocked
Calendar transport. They test both directions, narrow writes, bootstrap,
idempotency, leases, in-flight CRM edits, Google ETag errors, invalid dates,
deletions, archived jobs and allowlist gates. They are **not evidence of a
deployed trigger, real IAM/ACL permissions, or a completed live pilot**.
