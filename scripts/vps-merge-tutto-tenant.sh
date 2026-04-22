#!/usr/bin/env bash
# Merge Tutto Pizza tenant from fvresta_restore_apr16 into fvresta (same Postgres container).
# Prerequisite: fvresta_restore_apr16 exists and has the same schema as fvresta (run: npx prisma migrate deploy against it).
# Usage on VPS: bash scripts/vps-merge-tutto-tenant.sh
set -eu
TENANT="b38067d5-a0af-45b3-bf36-908746dc8892"
SRC_DB="fvresta_restore_apr16"
DST_DB="fvresta"
SEED_KONTAKT="00000000-0000-4000-8000-000000000003"
BACKUP_KONTAKT="7168619c-ce4b-48d6-a9bb-bdd65cd1001a"
CONTAINER="fv-control-postgres-1"

PSQL() { docker exec "$CONTAINER" psql -U fvresta -v ON_ERROR_STOP=1 "$@"; }

copy_pipe() {
  local sql=$1
  docker exec "$CONTAINER" psql -U fvresta -d "$SRC_DB" -c "\\copy ($sql) TO STDOUT" | docker exec -i "$CONTAINER" psql -U fvresta -d "$DST_DB" -c "\\copy $2 FROM STDIN"
}

echo "=== Safety: full dump of $DST_DB (inside container /tmp) ==="
docker exec "$CONTAINER" pg_dump -U fvresta -Fc -f "/tmp/fvresta-before-tutto-merge-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DST_DB"

echo "=== Persist seed kontakt password hash (before delete) ==="
PSQL -d "$DST_DB" -c "
DROP TABLE IF EXISTS _merge_kontakt_pwd;
CREATE TABLE _merge_kontakt_pwd (h text);
INSERT INTO _merge_kontakt_pwd SELECT \"passwordHash\" FROM \"User\" WHERE id = '$SEED_KONTAKT';
"

echo "=== Remove seed kontakt user (frees unique email) ==="
PSQL -d "$DST_DB" -c "
DELETE FROM \"RefreshToken\" WHERE \"userId\" = '$SEED_KONTAKT';
DELETE FROM \"user_roles\" WHERE \"userId\" = '$SEED_KONTAKT';
DELETE FROM \"auth_identities\" WHERE \"userId\" = '$SEED_KONTAKT';
DELETE FROM \"email_verification_tokens\" WHERE \"userId\" = '$SEED_KONTAKT';
DELETE FROM \"password_reset_tokens\" WHERE \"userId\" = '$SEED_KONTAKT';
DELETE FROM \"User\" WHERE id = '$SEED_KONTAKT';
"

echo "=== Disable triggers on all public tables ==="
PSQL -d "$DST_DB" -c "
DO \$\$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER ALL', r.tablename);
  END LOOP;
END\$\$;
"

echo "=== Copy Tutto Pizza rows ==="
copy_pipe "SELECT * FROM \"Tenant\" WHERE id = '$TENANT'" "\"Tenant\""
copy_pipe "SELECT * FROM \"User\" WHERE \"tenantId\" = '$TENANT'" "\"User\""
copy_pipe "SELECT * FROM roles WHERE \"tenantId\" = '$TENANT'" "roles"
copy_pipe "SELECT * FROM role_permissions WHERE \"roleId\" IN (SELECT id FROM roles WHERE \"tenantId\" = '$TENANT')" "role_permissions"
copy_pipe "SELECT * FROM user_roles WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"tenantId\" = '$TENANT')" "user_roles"
copy_pipe "SELECT * FROM subscriptions WHERE \"tenantId\" = '$TENANT'" "subscriptions"
copy_pipe "SELECT * FROM \"Contractor\" WHERE \"tenantId\" = '$TENANT'" "\"Contractor\""
copy_pipe "SELECT * FROM documents WHERE \"tenantId\" = '$TENANT'" "documents"
copy_pipe "SELECT * FROM mailboxes WHERE \"tenantId\" = '$TENANT'" "mailboxes"
copy_pipe "SELECT * FROM mailbox_sync_state WHERE \"mailboxId\" IN (SELECT id FROM mailboxes WHERE \"tenantId\" = '$TENANT')" "mailbox_sync_state"
copy_pipe "SELECT * FROM ingestion_sources WHERE \"tenantId\" = '$TENANT'" "ingestion_sources"
copy_pipe "SELECT * FROM tenant_settings WHERE \"tenantId\" = '$TENANT'" "tenant_settings"
copy_pipe "SELECT * FROM integration_credentials WHERE \"tenantId\" = '$TENANT'" "integration_credentials"
copy_pipe "SELECT * FROM \"IntegrationPos\" WHERE \"tenantId\" = '$TENANT'" "\"IntegrationPos\""
copy_pipe "SELECT * FROM agreements WHERE \"tenantId\" = '$TENANT'" "agreements"
copy_pipe "SELECT * FROM accounting_exports WHERE \"tenantId\" = '$TENANT'" "accounting_exports"
copy_pipe "SELECT * FROM audit_logs WHERE \"tenantId\" = '$TENANT'" "audit_logs"
copy_pipe "SELECT * FROM idempotency_keys WHERE \"tenantId\" = '$TENANT'" "idempotency_keys"
copy_pipe "SELECT * FROM source_messages WHERE \"tenantId\" = '$TENANT'" "source_messages"
copy_pipe "SELECT * FROM email_verification_tokens WHERE \"tenantId\" = '$TENANT'" "email_verification_tokens"
copy_pipe "SELECT * FROM password_reset_tokens WHERE \"tenantId\" = '$TENANT'" "password_reset_tokens"
copy_pipe "SELECT * FROM auth_identities WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"tenantId\" = '$TENANT')" "auth_identities"

copy_pipe "SELECT * FROM \"Invoice\" WHERE \"tenantId\" = '$TENANT'" "\"Invoice\""

INV_SUB="\"invoiceId\" IN (SELECT id FROM \"Invoice\" WHERE \"tenantId\" = '$TENANT')"
copy_pipe "SELECT * FROM \"InvoiceItem\" WHERE $INV_SUB" "\"InvoiceItem\""
copy_pipe "SELECT * FROM \"InvoiceFile\" WHERE $INV_SUB" "\"InvoiceFile\""
copy_pipe "SELECT * FROM \"InvoiceEvent\" WHERE $INV_SUB" "\"InvoiceEvent\""
copy_pipe "SELECT * FROM invoice_links WHERE $INV_SUB" "invoice_links"
copy_pipe "SELECT * FROM invoice_sources WHERE $INV_SUB" "invoice_sources"
copy_pipe "SELECT * FROM invoice_compliance_events WHERE $INV_SUB" "invoice_compliance_events"

copy_pipe "SELECT * FROM invoice_duplicates d WHERE EXISTS (SELECT 1 FROM \"Invoice\" i WHERE i.id = d.\"candidateInvoiceId\" AND i.\"tenantId\" = '$TENANT') AND EXISTS (SELECT 1 FROM \"Invoice\" j WHERE j.id = d.\"canonicalInvoiceId\" AND j.\"tenantId\" = '$TENANT')" "invoice_duplicates"

copy_pipe "SELECT * FROM extraction_runs WHERE \"tenantId\" = '$TENANT'" "extraction_runs"
copy_pipe "SELECT * FROM processing_jobs WHERE \"tenantId\" = '$TENANT'" "processing_jobs"
copy_pipe "SELECT pa.* FROM processing_attempts pa INNER JOIN processing_jobs j ON j.id = pa.\"jobId\" WHERE j.\"tenantId\" = '$TENANT'" "processing_attempts"
copy_pipe "SELECT sa.* FROM source_attachments sa INNER JOIN source_messages sm ON sm.id = sa.\"source_message_id\" WHERE sm.\"tenantId\" = '$TENANT'" "source_attachments"

echo "=== Re-enable triggers ==="
PSQL -d "$DST_DB" -c "
DO \$\$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER ALL', r.tablename);
  END LOOP;
END\$\$;
"

echo "=== Apply saved password hash to restored kontakt user ==="
PSQL -d "$DST_DB" -c "
UPDATE \"User\" u
SET \"passwordHash\" = m.h,
    \"updatedAt\" = NOW()
FROM _merge_kontakt_pwd m
WHERE u.id = '$BACKUP_KONTAKT' AND m.h IS NOT NULL;
DROP TABLE IF EXISTS _merge_kontakt_pwd;
"

echo "=== Verify ==="
PSQL -d "$DST_DB" -c "SELECT COUNT(*) AS tutto_invoices FROM \"Invoice\" WHERE \"tenantId\" = '$TENANT';"
PSQL -d "$DST_DB" -c "SELECT id, email, \"tenantId\" FROM \"User\" WHERE email = 'kontakt@tuttopizza.pl';"

echo "OK: merge finished. Restart API: systemctl --user restart fv-control-backend.service"
