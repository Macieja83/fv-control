#!/usr/bin/env bash
# Zrzut PostgreSQL z użyciem DATABASE_URL z backend/.env.
# Użycie (z hosta Linux / VPS): cd backend && ./scripts/backup-postgres.sh
# Opcjonalnie:
#   BACKUP_DIR=/mnt/backup/fv BACKUP_KEEP_DAYS=14 PG_CONTAINER=fv-control-postgres-1 ./scripts/backup-postgres.sh
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

DB_USER="$(node -e 'const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.username));' "$DATABASE_URL")"
DB_PASS="$(node -e 'const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.password));' "$DATABASE_URL")"
DB_NAME="$(node -e 'const u=new URL(process.argv[1]); process.stdout.write(u.pathname.replace(/^\//,""));' "$DATABASE_URL")"

detect_pg_container() {
  if [[ -n "${PG_CONTAINER:-}" ]]; then
    echo "$PG_CONTAINER"
    return
  fi
  docker ps --format '{{.Names}}' 2>/dev/null | grep -E '(^|-)postgres(-|$)' | head -1 || true
}

DEST="${BACKUP_DIR:-$HOME/backups/fv-control-db}"
mkdir -p "$DEST"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DEST/fv-control-${STAMP}.dump"
echo "Zapisuję: $OUT"
PG_CONTAINER="$(detect_pg_container)"
if [[ -n "$PG_CONTAINER" ]]; then
  docker exec -e PGPASSWORD="$DB_PASS" "$PG_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$OUT"
else
  pg_dump "$DATABASE_URL" -Fc -f "$OUT"
fi
ls -la "$OUT"
if [[ "${BACKUP_KEEP_DAYS:-}" =~ ^[0-9]+$ ]]; then
  find "$DEST" -type f -name 'fv-control-*.dump' -mtime +"$BACKUP_KEEP_DAYS" -delete
fi
echo "Gotowe."
