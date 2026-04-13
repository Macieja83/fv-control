#!/usr/bin/env bash
# Zrzut PostgreSQL z użyciem DATABASE_URL z backend/.env
# Użycie (z hosta Linux / VPS):  cd backend && ./scripts/backup-postgres.sh
# Opcjonalnie: BACKUP_DIR=/mnt/backup/fv ./scripts/backup-postgres.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -f .env ]]; then
  echo "Brak pliku .env w $ROOT — ustaw DATABASE_URL i uruchom ponownie." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL jest pusty w .env." >&2
  exit 1
fi
DEST="${BACKUP_DIR:-$HOME/backups/fv-control-db}"
mkdir -p "$DEST"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DEST/fv-control-${STAMP}.dump"
echo "Zapisuję: $OUT"
pg_dump "$DATABASE_URL" -Fc -f "$OUT"
ls -la "$OUT"
echo "Gotowe."
