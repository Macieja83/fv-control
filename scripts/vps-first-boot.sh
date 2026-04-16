#!/usr/bin/env bash
# Pierwsze uruchomienie na VPS (z katalogu głównego repozytorium po git clone / pull).
# Wymaga: Docker + Compose v2, opcjonalnie nginx (osobno).
#
# Użycie:
#   chmod +x scripts/vps-first-boot.sh
#   ./scripts/vps-first-boot.sh
#
# Opcje środowiska:
#   FV_ENV_FILE=production   # domyślnie: kopiuj backend/.env.production.example → backend/.env (gdy brak .env)
#   FV_ENV_FILE=staging      # używa backend/.env.staging.example
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_KIND="${FV_ENV_FILE:-production}"
case "$ENV_KIND" in
  production) SRC="$ROOT/backend/.env.production.example" ;;
  staging) SRC="$ROOT/backend/.env.staging.example" ;;
  *)
    echo "FV_ENV_FILE musi być 'production' lub 'staging' (jest: $ENV_KIND)" >&2
    exit 1
    ;;
esac

if [[ ! -f "$SRC" ]]; then
  echo "Brak pliku szablonu: $SRC" >&2
  exit 1
fi

if [[ ! -f "$ROOT/backend/.env" ]]; then
  cp "$SRC" "$ROOT/backend/.env"
  echo "Utworzono backend/.env z $SRC — UZUPEŁNIJ SEKRETY przed produkcją, potem uruchom ponownie ten skrypt."
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Brak polecenia 'docker'. Zainstaluj Docker Engine + Compose plugin." >&2
  exit 1
fi

echo "==> docker compose build (backend)"
(cd "$ROOT/backend" && docker compose build)

echo "==> docker compose up -d (backend)"
(cd "$ROOT/backend" && docker compose up -d)

echo "==> health"
curl -sS "http://127.0.0.1:3000/api/v1/health" && echo "" || true
curl -sS "http://127.0.0.1:3000/api/v1/ready" && echo "" || true

cat <<EOF

--- Następne kroki (ręcznie) ---
1. Frontend: cd $ROOT && npm ci && npm run build && sudo mkdir -p /var/www/fv-control && FV_WWW_ROOT=/var/www/fv-control ./scripts/deploy-fv-www.sh
2. nginx: skopiuj deploy/nginx-fv-control.example.conf → /etc/nginx/sites-available/ (dostosuj server_name i SSL).
3. Stripe: webhook → https://TWOJA_DOMENA/api/v1/billing/webhooks/stripe
4. Weryfikacja: cd $ROOT/backend && npm run verify:production-readiness -- --strict

Dokumentacja: $ROOT/docs/VPS-DEPLOY.md
EOF
