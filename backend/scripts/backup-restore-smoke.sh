#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DB_URL="$(awk -F= '/^DATABASE_URL=/{sub(/\r$/,"",$0); print substr($0,index($0,"=")+1); exit}' .env)"
if [[ -z "${DB_URL:-}" ]]; then
  echo "DATABASE_URL missing in .env" >&2
  exit 1
fi

DB_USER="$(node -e 'const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.username));' "$DB_URL")"
DB_PASS="$(node -e 'const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.password));' "$DB_URL")"
DB_NAME="$(node -e 'const u=new URL(process.argv[1]); process.stdout.write(u.pathname.replace(/^\//,""));' "$DB_URL")"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/fv-control-db}"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/fv-control-${STAMP}.dump"
RESTORE_DB="${DB_NAME}_restore_test_${STAMP}"
PG_CONTAINER="${PG_CONTAINER:-backend-postgres-1}"

export PGPASSWORD="$DB_PASS"

cleanup() {
  docker exec -e PGPASSWORD="$PGPASSWORD" "$PG_CONTAINER" dropdb -U "$DB_USER" "$RESTORE_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker exec -e PGPASSWORD="$PGPASSWORD" "$PG_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$BACKUP_FILE"
docker exec -e PGPASSWORD="$PGPASSWORD" "$PG_CONTAINER" createdb -U "$DB_USER" "$RESTORE_DB"
cat "$BACKUP_FILE" | docker exec -i -e PGPASSWORD="$PGPASSWORD" "$PG_CONTAINER" pg_restore -U "$DB_USER" -d "$RESTORE_DB" --no-owner --no-privileges

VERIFY="$(
  docker exec -e PGPASSWORD="$PGPASSWORD" "$PG_CONTAINER" psql -U "$DB_USER" -d "$RESTORE_DB" -At -F "|" \
    -c "SELECT (SELECT count(*) FROM \"Tenant\"),(SELECT count(*) FROM \"User\"),(SELECT count(*) FROM \"Invoice\"),(SELECT count(*) FROM \"subscriptions\");"
)"

echo "backup_file:$BACKUP_FILE"
echo "restore_db:$RESTORE_DB"
echo "verify_counts:$VERIFY"
echo "result:PASS"

