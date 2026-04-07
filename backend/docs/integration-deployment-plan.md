# Plan wdrożenia integracji (FV Control + Google Workspace + n8n + OpenClaw)

Ten dokument porządkuje **kolejność prac** i zakłada jedną ustaloną decyzję biznesową:

- **Główna skrzynka, do której mają wpadać faktury (źródło dla IMAP):** `maciejewski@tuttos.pl`.
- Pozostałe adresy firmowe (np. `kontakt@tuttopizza.pl`, inne aliasy na `tuttos.pl` / `tuttopizza.pl`) mają **doprowadzać pocztę do tej skrzynki** (alias Google Workspace albo forward w Admin Console), żeby FV Control czytał **jeden INBOX**.

Szczegóły techniczne IMAP: [zenbox-imap-setup.md](./zenbox-imap-setup.md) (endpointy `connectors/zenbox/*` obsługują dowolny serwer IMAP z TLS; dla Google używasz `imap.gmail.com`).

---

## Faza 0 — FV Control gotowy do produkcji

1. API pod **HTTPS**, baza Postgres, Redis, storage (S3/MinIO zgodnie z deployem).
2. Proces **`npm run worker`** (pipeline BullMQ + IMAP sync + webhook outbox) — bez workera maile nie zamkną się w pipeline ani outbox.
3. `ENCRYPTION_KEY` i sekrety produkcyjne ustawione (szyfrowanie credentiali integracji).

**Smoke:** `GET /api/v1/ready` = OK, zalogowanie `POST /api/v1/auth/login`, `GET /api/v1/invoices`.

---

## Faza 1 — Poczta → FV Control (priorytet #1)

### 1.1 Google Workspace (routing)

- Ustal, że **faktury zbieracie w skrzynce** `maciejewski@tuttos.pl`.
- Dla adresów pokroju `kontakt@tuttopizza.pl`: **alias do tego użytkownika** lub **forward** na `maciejewski@tuttos.pl`, żeby wiadomości (i załączniki) lądowały w jednym miejscu.

### 1.1b Forward już działa (tuttopizza → tuttos) — kolejne kroki

Gdy poczta z `kontakt@tuttopizza.pl` (lub innych adresów) **jest już widoczna w Odebranych** u `maciejewski@tuttos.pl`:

1. **Szybki test:** wyślij z zewnętrznej skrzynki mail na adres firmowy — sprawdź, że trafia do **INBOX** `maciejewski@tuttos.pl` (nie tylko „Wiadomości-śmieci”).
2. **Sekcja 1.2 poniżej** — IMAP + 2FA + hasło aplikacji na **`maciejewski@tuttos.pl`**.
3. **Faza 0** — API FV działa, **`npm run worker`** uruchomiony (Redis ten sam co API).
4. **Sekcja 1.3** — `POST /api/v1/connectors/zenbox/accounts` (host `imap.gmail.com`).
5. **Sekcja 1.4** — `POST .../sync`, potem `GET .../status`; wyślij **mail z PDF** na firmowy adres i sprawdź fakturę w FV.

Szczegółowe komendy: [zenbox-imap-setup.md](./zenbox-imap-setup.md).

### 1.2 IMAP dla tej skrzynki

- Włącz IMAP w ustawieniach Gmail dla tego konta.
- Włącz 2FA i wygeneruj **hasło aplikacji** (App Password) do poczty — to trafia do FV jako hasło IMAP (nie commituj go w repo).

Parametry połączenia:

| Pole | Wartość |
|------|---------|
| Host | `imap.gmail.com` |
| Port | `993` |
| TLS | `true` |
| Username | `maciejewski@tuttos.pl` |
| Password | App Password (16 znaków) |
| Mailbox | `INBOX` |

### 1.3 Rejestracja w FV Control (rola OWNER/ADMIN)

- `POST /api/v1/connectors/zenbox/accounts` z ciałem zawierającym powyższe pola.
- Sugerowany **`accountKey`** (etykieta wewnętrzna): np. `gmail-maciejewski-tuttos` (dowolna stabilna nazwa).

### 1.4 Sync i diagnostyka

- `POST /api/v1/connectors/zenbox/accounts/<accountKey>/sync`
- `GET /api/v1/connectors/zenbox/accounts/<accountKey>/status` — sprawdź brak `lastError`, rosnące liczniki załączników.
- Wyślij **testowy mail** z PDF faktury na adres, który kończy w tej skrzynce → weryfikacja w UI / `GET /api/v1/invoices`.

**Uwaga:** To jest praktyczna ścieżka „**IMAP + hasło aplikacji**”. Docelowo można zastąpić ją **Gmail OAuth + Gmail API** (plan rozwoju: [integration-rollout-prs.md](./integration-rollout-prs.md), etap B).

---

## Faza 2 — Automatyzacja zdarzeń (n8n)

1. Ustaw `N8N_WEBHOOK_URL` i `WEBHOOK_SIGNING_SECRET` (jeśli weryfikujesz podpis po stronie n8n).
2. Upewnij się, że worker wysyła outbox — [n8n-integration.md](./n8n-integration.md).
3. Pierwszy workflow w n8n: log / Slack / e-mail z payloadu zdarzenia (np. po `invoice.compliance.flagged`), potem rozbudowa.

---

## Faza 3 — Discord + OpenClaw (kanał ludzki)

Dopiero gdy Faza 1 działa stabilnie: agent z załącznikiem → `POST /api/v1/ingestion/manual-upload`, pytania → `GET /api/v1/invoices`. Opis: [openclaw-n8n-hybrid.md](./openclaw-n8n-hybrid.md).

---

## Faza 4 — KSeF (po stabilnym mailu i procesie)

Zgodnie z [integration-rollout-prs.md](./integration-rollout-prs.md) — klient KSeF, import, wysyłka zamiast stuba.

---

## Podsumowanie kolejności

| Kolejność | Temat |
|-----------|--------|
| 0 | FV + worker + HTTPS |
| 1 | Jeden inbox `maciejewski@tuttos.pl` + aliasy/forward + IMAP w FV + test maila z PDF |
| 2 | n8n + eventy z FV |
| 3 | OpenClaw / Discord |
| 4 | KSeF |

## Powiązane dokumenty

- [zenbox-imap-setup.md](./zenbox-imap-setup.md) — API, sync, metryki, troubleshooting IMAP.
- [n8n-integration.md](./n8n-integration.md) — outbound/inbound webhooki.
- [openclaw-n8n-hybrid.md](./openclaw-n8n-hybrid.md) — agent vs n8n.
- [integration-rollout-prs.md](./integration-rollout-prs.md) — długoterminowy podział na PR (Gmail OAuth, KSeF).
