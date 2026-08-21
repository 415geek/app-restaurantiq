#!/usr/bin/env bash
# Sync IQ V3 / MiMo / dual-verify env from .env.local to Vercel (production + preview + development).
# Prereq: vercel login && vercel link (from repo root)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
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

KEYS=(
  MIMO_API_KEY
  MIMO_API_BASE
  MIMO_IQ_PARTIAL_MODEL
  MIMO_IQ_FULL_MODEL
  MIMO_IQ_VERIFY_MODEL
  IQ_PRIMARY_PROVIDER
  IQ_ENABLE_DUAL_VERIFY
  IQ_VERIFY_PROVIDER
  IQ_FULL_REPORT_MIN_COMPLETENESS
)

cd "$ROOT"
VC="npx vercel"
count=0
for key in "${KEYS[@]}"; do
  val="$(get_var "$key")"
  if [[ -z "$val" ]]; then
    continue
  fi
  count=$((count + 1))
  echo "→ $key"
  for target in production development; do
    printf '%s' "$val" | $VC env add "$key" "$target" --force
  done
  # Preview: set VERCEL_PREVIEW_GIT_BRANCH to a non-production branch name if needed.
  if [[ -n "${VERCEL_PREVIEW_GIT_BRANCH:-}" ]]; then
    $VC env add "$key" preview "$VERCEL_PREVIEW_GIT_BRANCH" --value "$val" --yes --force
  fi
done

if [[ "$count" -eq 0 ]]; then
  echo "No IQ V3 keys set in $ENV_FILE" >&2
  exit 1
fi

echo "Synced $count variable(s). Redeploy: npx vercel --prod"
