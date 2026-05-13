#!/usr/bin/env bash
# Post-deploy smoke gate dla fv-control.
#
# Profile: prod (read-only) — odpalany po vps-update.sh.
# Wymaga env: SMOKE_BASE_URL, SMOKE_EMAIL, SMOKE_PASSWORD (typowo z ~/.smoke-env).
#
# Exit codes:
#   0 = OK (verify-production-readiness + smoke-ksef-readiness PASS)
#   1 = smoke FAIL (decyzja Marcina czy rollback)
#   2 = config error (brak env vars / brak backend/ katalogu)
#
# Usage:
#   source ~/.smoke-env && ./scripts/post-deploy-smoke.sh
#   SMOKE_RUN_KSEF_SYNC=1 ./scripts/post-deploy-smoke.sh  # plus opcjonalny manual sync
#
# Future profiles (staging full E2E z register): osobny skrypt post-deploy-smoke-staging.sh.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$ROOT/backend" ]]; then
  echo "[smoke] FAIL: brak $ROOT/backend (uruchom z roota repo)." >&2
  exit 2
fi

: "${SMOKE_BASE_URL:?[smoke] FAIL: SMOKE_BASE_URL nie ustawione (source ~/.smoke-env)}"
: "${SMOKE_EMAIL:?[smoke] FAIL: SMOKE_EMAIL nie ustawione}"
: "${SMOKE_PASSWORD:?[smoke] FAIL: SMOKE_PASSWORD nie ustawione}"

export SMOKE_BASE_URL SMOKE_EMAIL SMOKE_PASSWORD
export SMOKE_ALLOW_KSEF_MISSING="${SMOKE_ALLOW_KSEF_MISSING:-1}"
export SMOKE_RUN_KSEF_SYNC="${SMOKE_RUN_KSEF_SYNC:-0}"

echo "==> [1/2] verify:production-readiness --strict"
cd "$ROOT/backend"
if ! npm run --silent verify:production-readiness -- --strict; then
  echo "[smoke] FAIL (verify-production-readiness exit code != 0)" >&2
  exit 1
fi

echo "==> [2/2] smoke:ksef-readiness (base=$SMOKE_BASE_URL, allow_missing=$SMOKE_ALLOW_KSEF_MISSING, run_sync=$SMOKE_RUN_KSEF_SYNC)"
if ! npm run --silent smoke:ksef-readiness; then
  echo "[smoke] FAIL (smoke-ksef-readiness exit code != 0)" >&2
  exit 1
fi

echo "[smoke] PASS (prod post-deploy gate)"
exit 0
