# Zenbox IMAP — setup (krok po kroku)

## 1. Dane konta

Potrzebujesz od dostawcy / z panelu Zenbox:

| Pole | Opis |
|------|------|
| Host IMAP | np. host z dokumentacji Zenbox |
| Port | zwykle **993** (TLS) |
| Login | pełny adres e-mail lub login IMAP |
| Hasło | hasło do skrzynki (aplikacji) |
| TLS | `true` dla portu 993 |
| Skrzynka | domyślnie **`INBOX`** (inna ścieżka tylko jeśli faktycznie istnieje na serwerze) |

Te wartości trafiają do **`integration_credentials`** (zaszyfrowane); w logach aplikacji widać wyłącznie **redakcję** (`host`, `port`, `username`, `tls`, `mailbox`) — **nigdy hasła**.

## 2. API — rejestracja konta

Wymagana rola **OWNER** lub **ADMIN**.

1. Zaloguj się: `POST /api/v1/auth/login`.
2. Utwórz konto connector’a:

```bash
curl -sS -X POST "$API/api/v1/connectors/zenbox/accounts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"accountKey\":\"firma-glowna\",\"host\":\"imap.example.com\",\"port\":993,\"username\":\"fv@firma.pl\",\"password\":\"***\",\"tls\":true,\"mailbox\":\"INBOX\"}"
```

`accountKey` to **Twoja** stabilna etykieta (np. `zenbox-1`); mapuje się na `Mailbox.label` i `IntegrationCredential.label`.

## 3. Worker i Redis

Synchronizacja działa w procesie **`npm run worker`** (lub kontener `worker` w Docker):

- Ten sam **`REDIS_URL`** i **`BULLMQ_PREFIX`** co API.
- Kolejka BullMQ: **`imap-sync-zenbox`**.
- Równoległe sync’e dla tej samej pary `(tenantId, accountKey)` są blokowane kluczem Redis (TTL: **`IMAP_ZENBOX_LOCK_TTL_SEC`**).

## 4. Ręczne odpalenie sync

```bash
curl -sS -X POST "$API/api/v1/connectors/zenbox/accounts/firma-glowna/sync" \
  -H "Authorization: Bearer $TOKEN"
```

Odpowiedź zawiera `jobId` (BullMQ). Postęp: **`GET .../status`**.

## 5. Status i kursor UID

```bash
curl -sS "$API/api/v1/connectors/zenbox/accounts/firma-glowna/status" \
  -H "Authorization: Bearer $TOKEN"
```

- **`cursor.lastUid`** — ostatni przetworzony **IMAP UID** (inkluzywny kursor).
- **`cursor.uidValidity`** — ostatnio widziany **UIDVALIDITY** z serwera.
- Jeśli serwer zmieni **UIDVALIDITY** (np. przebudowa skrzynki), przy następnym sync kursor jest **zerowany** i wiadomości mogą zostać ponownie przejrzane (idempotencja na **`source_messages`** zapobiega duplikatom faktur po `Message-ID` / fallback UID).

## 6. Wymuszenie „resync”

- **Pełny re-scan UID:** ustaw w DB `imap_last_processed_uid` na `NULL` dla danego `mailbox_sync_state` (tylko świadomie, np. maintenance) albo polegaj na zmianie **UIDVALIDITY**.
- **Rotacja hasła:** `PATCH /api/v1/connectors/zenbox/accounts/:accountKey` z nowymi danymi, potem `POST .../sync`.

## 7. Diagnostyka

| Problem | Gdzie szukać |
|---------|----------------|
| Błąd połączenia / timeout | `status.lastError`, logi workera, metryki `fvcontrol_imap_sync_runs_total{status="error"}` |
| Duplikaty wiadomości | `fvcontrol_imap_duplicates_skipped_total{kind="message"}` — normalne przy powtórnym tym samym `Message-ID` |
| Duplikaty załączników | `kind="attachment"` + unikalność `(sourceMessageId, sha256)` |
| Ten sam plik PDF w wielu mailach | dedupe globalne po **`documents.sha256`** (istniejący intake) |
| Auth failure | zwykle **permanent** → job bez nieskończonych retry; popraw credentials i wyślij sync ponownie |

## 8. Metryki Prometheus

Na **`GET /metrics`** m.in.:

- `fvcontrol_imap_sync_runs_total{status}`
- `fvcontrol_imap_messages_fetched_total`
- `fvcontrol_imap_attachments_fetched_total`
- `fvcontrol_imap_duplicates_skipped_total{kind}`
- `fvcontrol_imap_sync_duration_seconds`
- `fvcontrol_imap_last_uid{tenant_id,account_key}`

## 9. Checklist przed produkcją

- [ ] `ENCRYPTION_KEY` ustawiony i zabezpieczony (sekret managera).
- [ ] Redis wysokiej dostępności; worker uruchomiony i monitorowany.
- [ ] Limity rozmiaru załączników / storage (S3/MinIO) skonfigurowane.
- [ ] Alerty na `imap_sync_runs_total{status="error"}` i na wzrost `duplicates_skipped` powyżej baseline.
- [ ] Runbook: [runbooks.md](./runbooks.md) (Zenbox IMAP).
