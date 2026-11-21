#!/usr/bin/env bash
set -euo pipefail

# Run only in the owner's authenticated Google Cloud Shell. Never print key contents.
PROJECT=rendermates-crm
ACCOUNT=crm-website-intake
EMAIL="$ACCOUNT@$PROJECT.iam.gserviceaccount.com"
ROLE=crmWebsiteLeadCreate

if [[ "${1:-}" != "--apply" ]]; then
  printf '%s\n' \
    "Dry run only. No changes made." \
    "Creates a NEW dedicated website identity, with datastore.entities.create only." \
    "It cannot read, update or delete existing CRM records." \
    "Creates a private JSON key for secure upload to WordPress Settings > Rendermates CRM." \
    "Does not change Firestore rules, Vercel, calendar functions, schedules or jobs." \
    "IAM applies to document creation across the database, not just the jobs collection." \
    "Run with --apply only after approving this identity and long-lived key."
  exit 0
fi

if gcloud iam service-accounts describe "$EMAIL" --project="$PROJECT" >/dev/null 2>&1; then
  echo "Stopped: account already exists. Review its permissions and keys; do not create another blindly." >&2
  exit 1
fi
if gcloud iam roles describe "$ROLE" --project="$PROJECT" >/dev/null 2>&1; then
  echo "Stopped: custom role already exists. Review it rather than replacing existing permissions." >&2
  exit 1
fi

umask 077
OUT="$(mktemp "$HOME/rendermates-website-key-XXXXXX.json")"
trap 'if [[ ! -s "$OUT" ]]; then rm -f "$OUT"; fi' EXIT
gcloud iam roles create "$ROLE" --project="$PROJECT" \
  --title="Website lead creation only" --permissions=datastore.entities.create --stage=GA --quiet >/dev/null
gcloud iam service-accounts create "$ACCOUNT" --project="$PROJECT" \
  --display-name="WordPress new leads only" --quiet >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$EMAIL" --role="projects/$PROJECT/roles/$ROLE" \
  --condition=None --quiet >/dev/null
gcloud iam service-accounts keys create "$OUT" --project="$PROJECT" --iam-account="$EMAIL" --quiet >/dev/null
printf 'Credential created privately at: %s\n' "$OUT"
echo "Download with Cloud Shell's file download menu; upload only in WordPress Settings > Rendermates CRM."
echo "Never paste it into chat, a command, email, a repository, or public_html."
echo "After the secure upload, delete downloaded and Cloud Shell copies. Revoke the key if exposed."
