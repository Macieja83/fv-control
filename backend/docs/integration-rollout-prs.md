# Kolejność PR: maile (3× Gmail + Zenbox) → KSeF

Plan zakłada **małe, weryfikowalne PR-y** — każdy daje działający fragment produkcji (lub staging), bez „wielkiego bang” na końcu.

## Założenia

- **Modele** `Mailbox`, `MailboxSyncState`, `IntegrationCredential` już są w Prisma — brakuje **API zarządzania**, **workera synchronizacji** i **prawdziwych connectorów**.
- **Pipeline** (`manual-upload` → `Document` → BullMQ) jest — mail ma kończyć w **tym samym** torze (załącznik → storage → job).
- **3 Gmail + 1 Zenbox:** **4 wiersze `Mailbox`** — 3× `provider: GMAIL`, 1× `provider: IMAP` (Zenbox; credential z `ConnectorType.IMAP_ZENBOX` w `IntegrationCredential`).

---

## Etap A — Zenbox IMAP pierwszy (najkrótsza ścieżka do „prawdziwej” poczty)

### PR A1 — API: skrzynki i credential (bez IMAP)

**Cel:** Możliwość utworzenia skrzynek i podpięcia zaszyfrowanego sekretu bez ręcznego SQL.

- `POST/GET/PATCH /api/v1/mailboxes` (tenant-scoped, role jak integracje).
- `POST /api/v1/integration-credentials` (lub rozszerzenie istniejącego wzorca) — zapis **OAuth / IMAP password** przez istniejące `encryptSecret`.
- Przy tworzeniu `Mailbox` — opcjonalnie utwórz pusty `MailboxSyncState`.
- Testy: tworzenie skrzynki Zenbox + credential, odczyt dashboardu (`syncState.lastError` null).

**Dlaczego przed IMAP:** worker musi mieć skąd czytać listę skrzynek.

### PR A2 — Worker: pętla synchronizacji maili (odpowiedzialność + metryki)

**Cel:** Osobny timer lub BullMQ **repeatable job** `mail-sync` co N sekund (config np. `MAIL_SYNC_INTERVAL_MS`).

- Dla każdej aktywnej skrzynki: wywołanie factory connectorów (nadal stub dla Gmail).
- Aktualizacja `MailboxSyncState.lastSyncedAt` / `lastError`.
- Metryki: `fvcontrol_mail_sync_total{provider,status}`, histogram czasu.
- **Idempotencja:** ten sam `Message-Id` / hash załącznika → ten sam tor co dedup dokumentów.

### PR A3 — Connector: Zenbox IMAP (prawdziwy)

**Cel:** `ImapConnector.poll` → pobranie nowych UID od `uidNext` / `UIDVALIDITY`, lista załączników PDF/XML.

- Biblioteka typu **imapflow** (sesje, TLS).
- Odczyt/zapis `uidValidity`, `uidNext` w `MailboxSyncState`.
- Błędy sieciowe → `lastError` + retry z backoff (bez zabijania całego workera).
- Po pobraniu: zapis bloba do **tego samego** storage co `manual-upload`, utworzenie `Document` + enqueue pipeline (wspólna funkcja z `manual-upload.service`).

**Acceptance:** jedna wiadomość testowa z PDF w staging → widoczny `Document` + `ProcessingJob` + faktura w kolejce review.

---

## Etap B — Gmail (3 konta)

### PR B1 — OAuth2 Google: start + callback + refresh token

**Cel:** Dla każdej z 3 skrzynek osobny flow (albo ten sam endpoint z parametrem `mailboxId` / `state`).

- Rejestracja w Google Cloud: **OAuth consent**, redirect URI do API.
- `GET /api/v1/integrations/google/oauth/start?mailboxId=…` → redirect.
- `GET /api/v1/integrations/google/oauth/callback` → wymiana code → **refresh token**, zapis w `IntegrationCredential` (`kind: OAUTH_TOKENS`, JSON w `metadata` + refresh w `secretEncrypted` według ustalonej konwencji).
- Job/helper **odświeżania access tokena** (w pamięci na czas sync).

**Acceptance:** 3 mailboxes, 3 credentiali, `connectors/status` pokazuje `googleOAuthConfigured: true`.

### PR B2 — Gmail API: lista + załączniki (history lub poll)

**Cel:** Zastąpić stub `GmailConnector.fetchIncremental`.

- **Wariant 1 (zalecany na dłużej):** Gmail **History API** + `historyId` w `MailboxSyncState`.
- **Wariant 2 (prostszy start):** label/query + `after:` + dedup po `messageId` (mniej eleganckie, OK na MVP).
- Pobranie załączników → storage → `Document` + pipeline (wspólny kod z PR A3).

**Acceptance:** 3 skrzynki w jednym ticku workera; brak cross-tenant leak (filtr `tenantId` na `Mailbox`).

### PR B3 — Twarde limity i operacje

- Limity równoległości na tenant (np. max 1 sync na skrzynkę).
- Pub/Sub (opcjonalnie osobny PR): tylko jeśli polling nie wystarcza — [architecture known gap](./architecture.md).

---

## Etap C — KSeF (po stabilnym mailu)

### PR C1 — Klient HTTP KSeF (sandbox → prod)

**Cel:** Moduł `src/adapters/ksef/` (lub `modules/ksef/`): base URL z `KSEF_ENV`, timeouty, klasyfikacja błędów (401 vs 429 vs 4xx walidacji).

- Auth zgodnie z wybraną ścieżką MF (**cert / token** — jedna na start).
- Implementacja `KsefConnector.listSince` / `fetchOne` z prawdziwym API.
- Sekrety wyłącznie w `IntegrationCredential`, nie w logach.

### PR C2 — Mapowanie XML → intake + faktura

**Cel:** `fetchOne` → parser (FA XML) → `POST` wewnętrznie do istniejącej ścieżki intake / aktualizacja `Invoice` z `intakeSourceType: KSEF_API`, `hasStructuredKsefPayload: true`.

- Idempotencja po identyfikatorze KSeF (`sourceExternalId` / `InvoiceLink`).
- Worker okresowy: `listSince` + kolejka jobów (nie blokować requestu HTTP).

### PR C3 — Wysyłka do KSeF (zamiast stuba)

**Cel:** `POST /invoices/:id/send-to-ksef` wywołuje prawdziwy connector dla faktur **własnej sprzedaży** (`ksefRequired`, `legalChannel`).

- Stany `ksefStatus`, obsługa odrzuceń → `FAILED_NEEDS_REVIEW` lub `REJECTED` + event compliance.

---

## Etap D — Produkt / observability (równolegle lub tuż po)

- UI admin: lista skrzynek + `lastError` (dashboard API już zwraca `connectors.mailboxes`).
- Alerty na `lastError` nie-null przez X godzin.
- Runbook: rotacja tokenów Google, odświeżenie certyfikatu KSeF.

---

## Podsumowanie kolejności (numeracja)

| Kolejność | PR | Wynik |
|-----------|-----|--------|
| 1 | A1 | CRUD skrzynek + credentials |
| 2 | A2 | Worker mail-sync + metryki |
| 3 | A3 | Zenbox IMAP live → dokumenty |
| 4 | B1 | Gmail OAuth × konta |
| 5 | B2 | Gmail sync + załączniki |
| 6 | B3 | Limity / opcjonalnie Pub/Sub |
| 7 | C1 | Klient KSeF |
| 8 | C2 | Import z KSeF do faktur |
| 9 | C3 | Wysyłka KSeF (sprzedaż) |

**Zenbox przed Gmail** celowo: mniej zależności zewnętrznych, szybsze „pierwsze end-to-end”. Jeśli biznesowo pilniejszy jest Gmail, zamień **A3** z **B1+B2** (wtedy A2 musi już rozróżniać providerów i nie wymagać IMAP dla Gmail).

---

## Zależności poza kodem (checklist przed B1 / C1)

- Konto **Google Cloud**, ekran zgody OAuth, redirect HTTPS na staging/prod.
- Dla KSeF: dostęp **sandbox MF**, wybrany model uwierzytelniania, ewentualny profil testowy NIP.
- **DNS / TLS** dla callbacków OAuth.
