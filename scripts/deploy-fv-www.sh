#!/usr/bin/env bash
# Kopiuj zbudowany frontend (Vite) do katalogu serwowanego przez nginx (produkcja: https://fv.resta.biz → /var/www/fv-control).
# Kanon domeny i portu API: backend/docs/deploy-systemd-api-and-worker.md
# Użycie (na VPS, z katalogu głównego repozytorium):
#   npm ci && npm run build && ./scripts/deploy-fv-www.sh
# Opcjonalnie inny docroot:
#   FV_WWW_ROOT=/var/www/fv-control ./scripts/deploy-fv-www.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${FV_WWW_ROOT:-/var/www/fv-control}"
if [ ! -d "$ROOT/dist" ]; then
  echo "Brak $ROOT/dist — najpierw: cd \"$ROOT\" && npm ci && npm run build" >&2
  exit 1
fi
if [ ! -d "$DEST" ]; then
  echo "Brak katalogu docelowego: $DEST (ustaw FV_WWW_ROOT lub utwórz katalog)" >&2
  exit 1
fi
rsync -a --delete "$ROOT/dist/" "$DEST/"
echo "OK: zsynchronizowano $ROOT/dist/ -> $DEST/"
