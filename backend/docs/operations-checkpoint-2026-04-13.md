# Punkt kontrolny operacji — 2026-04-13 (KSeF + pipeline)

Ten dokument zapisuje **stan po naprawie** synchronizacji KSeF, osieroconych dokumentów XML i narzędzi operacyjnych. Odpowiada tagowi Git: **`ops-ksef-recovery-2026-04-13`**.

## Co było problemem

- W bazie były **dokumenty KSeF (XML) bez powiązanej faktury** (`Invoice`), podczas gdy MF zwracał 54 faktury w Issue (kwiecień), a w FV Control widać było 45.
- Sync traktował sam `Document` jako duplikat i **nie tworzył faktury**; diff porównywał wyłącznie `Invoice`.

## Co wdrożono (kod)

- Priorytet **`issueDate`** z metadanych MF / numeru KSeF + normalizacja kalendarzowa (`parseIssueDateCalendarYmd`).
- **`resumePipelineForOrphanKsefDocument`** — odtworzenie `Invoice` + joba pipeline dla istniejącego XML.
- **`linkKsefNumberToInvoiceIfNeeded`** — uzupełnienie `ksefNumber`, gdy faktura jest, pole było puste.
- Skrypty: `ingest-ksef-by-numbers`, `diff-ksef-issue-metadata-vs-db`, `diagnose-ksef-number`, `run-pending-pipeline-jobs`, `tenant-pipeline-status`, `cleanup-broken-pipeline-jobs`, `repair-ksef-issue-dates-from-doc-metadata`.

## Tenant produkcyjny (przykład z interwencji)

- `tenantId`: `b38067d5-a0af-45b3-bf36-908746dc8892`
- Weryfikacja diff (Issue kwiecień 2026): **54 / `missingInDbCount: 0`**
- Po interwencji: **`invoicesIngesting: 0`**, usługa **`fv-control-worker.service`** — restart wykonany.

## Jak odtworzyć ten stan w kodzie

```bash
git fetch origin
git checkout ops-ksef-recovery-2026-04-13
# lub: git merge ops-ksef-recovery-2026-04-13
```

## Kopia zapasowa bazy (VPS / Linux)

Z katalogu `backend`, przy załadowanym `.env` z prawidłowym `DATABASE_URL`:

```bash
chmod +x scripts/backup-postgres.sh
./scripts/backup-postgres.sh
```

Domyślnie zrzut trafia do `~/backups/fv-control-db/` (format custom `-Fc`).  
Nadpisanie katalogu: `BACKUP_DIR=/ścieżka/do/kopii ./scripts/backup-postgres.sh`

### Gdy `pg_dump: command not found`

Zainstaluj klienta PostgreSQL (Debian/Ubuntu):

```bash
sudo apt-get update && sudo apt-get install -y postgresql-client
```

**Albo** zrzut z kontenera Docker (gdy baza działa jako usługa `postgres` z `docker-compose.yml` w katalogu głównym repo):

```bash
mkdir -p ~/backups/fv-control-db
cd ~/fv-control
docker compose exec -T postgres pg_dump -U fvresta -d fvresta -Fc > ~/backups/fv-control-db/fv-control-docker-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Dostosuj `-U` / `-d`, jeśli w `docker-compose.yml` masz inne wartości niż domyślne `fvresta`.

Przywracanie (skrót):

```bash
pg_restore --clean --if-exists -d "$DATABASE_URL" /ścieżka/do/pliku.dump
```

**Uwaga:** nie commituj `.env` ani plików `.dump` do Git. Trzymaj kopie poza repozytorium (S3, inny dysk, szyfrowany archiwum).

## Kopia zapasowa repozytorium (sam kod)

Tag jest już na `origin`; dodatkowo lokalnie:

```bash
git archive --format=tar.gz -o fv-control-ops-ksef-recovery-2026-04-13.tar.gz ops-ksef-recovery-2026-04-13
```
