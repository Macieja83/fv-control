-- Usuwa z tenantu demo duplikaty KSeF: te same sourceExternalId co u Tutto (import przy złym tenancie).
-- Faktury „z 17–20.04” na demo miały sztuczną datę wystawienia 2026-04-20; kanoniczne rekordy są już u Tutto z prawdziwymi datami.
BEGIN;

CREATE TEMP TABLE _dup_demo AS
SELECT i_d.id
FROM "Invoice" i_d
INNER JOIN "Invoice" i_t
  ON i_t."tenantId" = 'b38067d5-a0af-45b3-bf36-908746dc8892'
  AND i_t."ingestionKind" IS NOT DISTINCT FROM i_d."ingestionKind"
  AND i_t."sourceExternalId" IS NOT DISTINCT FROM i_d."sourceExternalId"
WHERE i_d."tenantId" = '00000000-0000-4000-8000-000000000001'
  AND i_d."issueDate" >= DATE '2026-04-17'
  AND i_d."issueDate" <= DATE '2026-04-20';

SELECT COUNT(*) AS to_delete FROM _dup_demo;

DELETE FROM invoice_duplicates d
WHERE d."candidateInvoiceId" IN (SELECT id FROM _dup_demo)
   OR d."canonicalInvoiceId" IN (SELECT id FROM _dup_demo);

DELETE FROM "Invoice" WHERE id IN (SELECT id FROM _dup_demo);

-- Osierocone dokumenty demo (64 szt.), bez odwołań
DELETE FROM documents d
WHERE d."tenantId" = '00000000-0000-4000-8000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."primaryDocId" = d.id)
  AND NOT EXISTS (SELECT 1 FROM extraction_runs er WHERE er."documentId" = d.id)
  AND NOT EXISTS (SELECT 1 FROM processing_jobs pj WHERE pj."documentId" = d.id)
  AND NOT EXISTS (SELECT 1 FROM "InvoiceFile" f WHERE f."documentId" = d.id);

COMMIT;

SELECT COUNT(*) AS demo_left_in_range FROM "Invoice"
WHERE "tenantId" = '00000000-0000-4000-8000-000000000001'
  AND "issueDate" >= DATE '2026-04-17' AND "issueDate" <= DATE '2026-04-20';
