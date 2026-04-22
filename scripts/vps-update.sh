#!/usr/bin/env bash
# Aktualizacja FV Control na VPS (katalog główny repozytorium, typowo ~/fv-control).
# Wymaga: Node.js, npm, git, rsync; backend: `backend/.env` poprawne.
# Dla wariantu systemd (user): fv-control-backend.service, fv-control-worker.service.
#
#   chmod +x scripts/vps-update.sh
#   ./scripts/vps-update.sh
#
# Zmienne:
#   FV_WWW_ROOT  — docroot frontu (domyślnie /var/www/fv-control, jak deploy-fv-www.sh)
#   SKIP_GIT=1   — pomiń `git pull` (np. już ściągnięte)
#   SKIP_MIGRATIONS=1 — pomiń `prisma migrate deploy` (odważ używać tylko świadomie)
#   SKIP_SYSTEMD=1  — pomiń restart usług usera
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BRANCH="${VPS_GIT_BRANCH:-main}"

if [[ "${SKIP_GIT:-0}" != "1" ]]; then
  echo "==> git pull origin $BRANCH"
  git pull origin "$BRANCH"
else
  echo "==> SKIP_GIT=1 — pomijam git pull"
fi

echo "==> frontend: npm ci && npm run build"
npm ci
npm run build

DEST="${FV_WWW_ROOT:-/var/www/fv-control}"
if [[ -d "$DEST" ]]; then
  echo "==> deploy frontend -> $DEST"
  FV_WWW_ROOT="$DEST" ./scripts/deploy-fv-www.sh
else
  echo "Uwaga: brak katalogu $DEST (nginx root). Ustaw FV_WWW_ROOT=... lub: sudo mkdir -p $DEST" >&2
  echo "       Pomijam rsync; zbudowano tylko $ROOT/dist/" >&2
fi

echo "==> backend: npm ci && build && migracje"
cd "$ROOT/backend"
npm ci
npm run build
if [[ "${SKIP_MIGRATIONS:-0}" != "1" ]]; then
  npx prisma migrate deploy
else
  echo "==> SKIP_MIGRATIONS=1"
fi

if [[ "${SKIP_SYSTEMD:-0}" != "1" ]]; then
  if systemctl --user is-active --quiet fv-control-backend.service 2>/dev/null; then
    echo "==> systemctl --user restart backend + worker"
    systemctl --user restart fv-control-backend.service
    systemctl --user restart fv-control-worker.service
  else
    echo "Ostrzeżenie: fv-control-backend.service (user) nieaktywne — pomiń restart albo użyj Dockera." >&2
  fi
else
  echo "==> SKIP_SYSTEMD=1"
fi

echo "==> health (localhost, domyślnie PORT=3000)"
if curl -fsS "http://127.0.0.1:3000/api/v1/ready" >/dev/null 2>&1; then
  curl -sS "http://127.0.0.1:3000/api/v1/ready" | head -c 500 || true
  echo
else
  echo "Nie odpowiada :3000/api/v1/ready (sprawdź PORT w backend/.env)." >&2
fi
echo "OK: vps-update zakończony."
