-- Usuwa dokumenty demo bez faktury (po skasowaniu duplikatów).
BEGIN;

DELETE FROM extraction_runs er
WHERE er."documentId" IN (
  SELECT d.id FROM documents d
  WHERE d."tenantId" = '00000000-0000-4000-8000-000000000001'
    AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."primaryDocId" = d.id)
);

DELETE FROM processing_jobs pj
WHERE pj."documentId" IN (
  SELECT d.id FROM documents d
  WHERE d."tenantId" = '00000000-0000-4000-8000-000000000001'
    AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."primaryDocId" = d.id)
);

DELETE FROM documents d
WHERE d."tenantId" = '00000000-0000-4000-8000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."primaryDocId" = d.id);

COMMIT;
