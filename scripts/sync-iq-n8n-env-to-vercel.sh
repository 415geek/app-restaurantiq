#!/usr/bin/env bash
# Sync IQ n8n webhook env from .env.local to Vercel (production + preview).
# Prereq: vercel login && vercel link (from repo root)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy from .env.example and set N8N_IQ_* first." >&2
  exit 1
fi

get_var() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 || true)"
  if [[ -z "$line" ]]; then
    echo "" 
    return
  fi
  echo "${line#*=}"
}

ANALYZE="$(get_var N8N_IQ_ANALYZE_WEBHOOK_URL)"
FULL="$(get_var N8N_IQ_FULL_REPORT_WEBHOOK_URL)"
SECRET="$(get_var N8N_IQ_WEBHOOK_SECRET)"

if [[ -z "$ANALYZE" ]]; then ANALYZE="$(get_var N8N_ANALYZE_WEBHOOK_URL)"; fi
if [[ -z "$FULL" ]]; then FULL="$(get_var N8N_FULL_REPORT_WEBHOOK_URL)"; fi

for v in ANALYZE FULL SECRET; do
  if [[ -z "${!v}" ]]; then
    echo "Missing required value for $v in $ENV_FILE" >&2
    exit 1
  fi
done

cd "$ROOT"

echo "Setting Vercel env (you may be prompted per variable)..."
VC="npx vercel"
for target in production development; do
  printf '%s' "$ANALYZE" | $VC env add N8N_IQ_ANALYZE_WEBHOOK_URL "$target" --force
  printf '%s' "$FULL" | $VC env add N8N_IQ_FULL_REPORT_WEBHOOK_URL "$target" --force
  printf '%s' "$SECRET" | $VC env add N8N_IQ_WEBHOOK_SECRET "$target" --force
done
$VC env add N8N_IQ_ANALYZE_WEBHOOK_URL preview --value "$ANALYZE" --yes --force
$VC env add N8N_IQ_FULL_REPORT_WEBHOOK_URL preview --value "$FULL" --yes --force
$VC env add N8N_IQ_WEBHOOK_SECRET preview --value "$SECRET" --yes --force

echo "Done. Redeploy production for env to take effect: npx vercel --prod"
