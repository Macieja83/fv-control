# Mail (Gmail IMAP) → FV Control — instrukcja komenda po komendzie (VPS / SSH)

Wykonujesz **na serwerze z dostępem do `curl`** (najczęściej SSH, np. `marcin@srv1362287`).  
**Nie wklejaj** haseł ani tokenów do czatu w Cursorze — tylko w terminalu.

**Wymagania z góry:**

- Faktury kończą w **INBOX** `maciejewski@tuttos.pl` (forward z tuttopizza już działa).
- Na koncie `maciejewski@tuttos.pl`: **IMAP włączony**, **2FA**, **Google App Password** (16 znaków **bez spacji**).
- Działa **backend FV** pod znanym adresem (HTTPS lub `http://127.0.0.1:PORT` jeśli curl jest na tym samym hoście).
- **Redis** uruchomiony, **`npm run worker`** działa z **tym samym** `REDIS_URL` i `BULLMQ_PREFIX` co API.
- Masz użytkownika **OWNER** lub **ADMIN** w FV (email + hasło logowania do panelu/API).

Odpowiedź logowania z API zwraca pole **`accessToken`** (JWT) — tego używasz w nagłówku `Authorization`.

---

## Krok 0 — Wejdź na serwer i otwórz jedną sesję bash

```bash
ssh marcin@TWÓJ_SERWER
```

Wszystkie kolejne komendy w **tej samej** sesji (żeby działały `export`).

---

## Krok 1 — Ustaw adres API (obowiązkowe)

**Wklej jedną linię** — podstaw **swój** prawdziwy host (bez końcowego `/`).

Przykład publiczny:

```bash
export API="https://fv.twoja-domena.pl"
```

Przykład gdy API jest tylko lokalnie na tym samym VPS:

```bash
export API="http://127.0.0.1:3000"
```

**Sprawdź**, że zmienna nie jest pusta:

```bash
echo "$API"
```

Musisz zobaczyć pełny URL, np. `https://fv.twoja-domena.pl` — **nie** pustą linię.

---

## Krok 2 — Test, czy API żyje

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\n" "$API/api/v1/health"
```

Oczekiwane: kod **200** (lub inny sukces).  
Jeśli błąd typu **URL rejected: No host part** → wróć do Kroku 1 (`API` puste lub złe).

---

## Krok 3 — Zaloguj się i zapisz token

**Wariant A — hasło wpisujesz ręcznie (bezpieczniej)**

Zmień tylko **email** na swojego OWNER/ADMIN:

```bash
curl -sS -X POST "$API/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@twoja-domena.pl\",\"password\":\"TUTAJ_HASŁO\"}"
```

**Wariant B — hasło nie trafia do historii poleceń (`read -s`)**

```bash
read -s FV_PASS
export FV_PASS
curl -sS -X POST "$API/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@twoja-domena.pl\",\"password\":\"$FV_PASS\"}"
unset FV_PASS
```

W odpowiedzi JSON znajdź pole **`accessToken`** (długi ciąg zaczynający się często od `eyJ`).

**Zapisz token w tej sesji** (wklej **cały** `accessToken` w cudzysłowie):

```bash
export TOKEN="Wklej_tutaj_wartość_accessToken_z_JSON"
```

Sprawdź:

```bash
test -n "$TOKEN" && echo "TOKEN ustawiony" || echo "TOKEN pusty — popraw Krok 3"
```

---

## Krok 4 — Zarejestruj skrzynkę Gmail (IMAP) w FV

**Najpierw** ustaw zmienną z hasłem aplikacji (**16 znaków bez spacji**) — żeby nie wpisywać go w jednej długiej linii z `curl`:

```bash
read -s IMAP_APP_PASS
export IMAP_APP_PASS
```

Teraz **wklej i uruchom** (nazwa konta wewnętrznego: `gmail-maciejewski-tuttos` — możesz zmienić, ale wtedy zmień też Kroki 5–6):

```bash
curl -sS -X POST "$API/api/v1/connectors/zenbox/accounts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg pass "$IMAP_APP_PASS" \
    '{accountKey:"gmail-maciejewski-tuttos",host:"imap.gmail.com",port:993,username:"maciejewski@tuttos.pl",password:$pass,tls:true,mailbox:"INBOX"}')"
unset IMAP_APP_PASS
```

Jeśli **nie masz `jq`**, użyj ręcznie (hasło w cudzysłowie, uważaj na znaki specjalne w haśle):

```bash
curl -sS -X POST "$API/api/v1/connectors/zenbox/accounts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountKey":"gmail-maciejewski-tuttos","host":"imap.gmail.com","port":993,"username":"maciejewski@tuttos.pl","password":"TUTAJ_16_ZNAKOW_BEZ_SPACJI","tls":true,"mailbox":"INBOX"}'
```

Oczekiwana odpowiedź (m.in.): `"ok":true`, `credentialId`, `mailboxId`.  
Błąd **403** → konto nie jest OWNER/ADMIN. **401** → zły/wygasły `TOKEN` (powtórz Krok 3).

**Jeśli konto już istnieje** i zmieniasz tylko hasło:

```bash
curl -sS -X PATCH "$API/api/v1/connectors/zenbox/accounts/gmail-maciejewski-tuttos" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host":"imap.gmail.com","port":993,"username":"maciejewski@tuttos.pl","password":"NOWE_APP_PASSWORD","tls":true,"mailbox":"INBOX"}'
```

---

## Krok 5 — Upewnij się, że działa worker

Bez workera kolejka IMAP się nie wykona. Sposób zależy od deployu:

- **Docker Compose:** `docker compose ps` — kontener `worker` **Up**.
- **systemd:** `systemctl status fv-worker` (lub jak u Ciebie nazywa się usługa).
- **Ręcznie (test):** w katalogu `backend` na serwerze, z tym samym `.env` co API: `npm run worker` (w osobnym tmux/screen).

Worker musi widzieć **ten sam** `REDIS_URL` co proces API.

---

## Krok 6 — Odpal synchronizację (enqueue job)

```bash
curl -sS -X POST "$API/api/v1/connectors/zenbox/accounts/gmail-maciejewski-tuttos/sync" \
  -H "Authorization: Bearer $TOKEN"
```

Oczekiwane: `"ok":true`, często `jobId`.  
Jeśli **403/401** → token lub rola.

---

## Krok 7 — Sprawdź status skrzynki

```bash
curl -sS "$API/api/v1/connectors/zenbox/accounts/gmail-maciejewski-tuttos/status" \
  -H "Authorization: Bearer $TOKEN"
```

- **`lastError`: `null`** → dobrze.
- **`lastError`** z tekstem → zwykle IMAP auth, sieć, wyłączone IMAP; popraw hasło / ustawienia Google, potem **PATCH** (Krok 4) i znów **sync** (Krok 6).
- **`counts.sourceAttachments`** — powinno rosnąć po mailach z załącznikami.

---

## Krok 8 — Test końcowy (faktura z maila)

1. Wyślij e-mail z **PDF faktury** na adres, który **kończy** w `maciejewski@tuttos.pl` (np. `kontakt@tuttopizza.pl`).
2. Poczekaj chwilę, aż mail będzie w Gmailu.
3. Ponów **Krok 6** (sync), potem **Krok 7** (status).

Lista faktur (paginacja domyślna):

```bash
curl -sS "$API/api/v1/invoices?limit=20&page=1" \
  -H "Authorization: Bearer $TOKEN" | head -c 2000
```

Albo sprawdź w **UI** aplikacji.

---

## Szybka ściąga błędów

| Objaw | Działanie |
|--------|-----------|
| `No host part in the URL` | `echo $API` → ustaw pełny URL w Kroku 1. |
| `401` na `/connectors/...` | Wygasł access token — ponów login (Krok 3). |
| `403` | Użytkownik nie jest OWNER/ADMIN. |
| `lastError` IMAP | App Password, IMAP w Gmailu, blokada admina Workspace. |
| Sync OK, brak faktur | Worker; logi pipeline; w `status` czy rośnie `sourceAttachments`. PDF w mailu często ma MIME `application/octet-stream` — od wersji z poprawką w `isInvoiceCandidateAttachment` takie załączniki z `.pdf` są przyjmowane (**wdróż nowy backend**). Maile już oznaczone jako obsłużone (`processedAt`) bez załącznika nie są ponownie skanowane — **wyślij nowy testowy mail** po wdrożeniu. |

---

## Diagnoza: brak faktur na fv.resta.biz (produkcja)

**fv.resta.biz** to tylko adres UI/API — faktury z maila **nie „przechodzą same”**, dopóki na tym serwerze nie działa **nowy backend** + **worker** + **nowy mail** po ewentualnej poprawce IMAP.

1. **Wdrożenie** — czy na produkcji jest obraz / build z commitem **`fix(imap): accept … octet-stream`** (parser PDF jako `application/octet-stream`)? Bez tego wiele PDF z poczty jest **ciszej odrzucanych**.
2. **Worker** — **osobny proces** `npm run worker:start` (produkcja) lub `npm run worker` (dev). Sam **`npm run start`** (API) **nie** przetwarza kolejki — bez workera faktury z maila **nie dojdą** do UI. Instrukcja systemd: [deploy-systemd-api-and-worker.md](./deploy-systemd-api-and-worker.md).
3. **`GET .../connectors/zenbox/accounts/.../status`** — czy **`counts.sourceAttachments`** rośnie po **nowym** mailu z **`nazwa.pdf`**? Jeśli **0** → załącznik nie jest kandydatem albo IMAP nie widzi maila w INBOX.
4. **Stare maile** — jeśli sync wcześniej ustawił `processedAt` na wiadomości **bez** PDF, **ponowny sync tego maila nie pomoże**. Wyślij **nowy** test z załącznikiem PDF.
5. **`.env` produkcji** — `FEATURE_AI_EXTRACTION_MOCK=true` (domyślnie tak). Przy `false` mock zwraca pusty draft i pipeline może paść na braku numeru faktury.
6. **Ten sam tenant w UI** — logujesz się jako użytkownik z **tego samego** `tenantId`, co konto użyte przy `POST .../zenbox/accounts`.
7. **Logi workera** — szukaj `VALIDATION`, `EXTRACT`, błędów **S3/storage** (`STORAGE_DRIVER`, MinIO).

---

## Powiązane

- [zenbox-imap-setup.md](./zenbox-imap-setup.md) — szczegóły techniczne, metryki.
- [cursor-agent-handoff.md](./cursor-agent-handoff.md) — co robi Agent w Cursorze vs Ty na VPS.
- [integration-deployment-plan.md](./integration-deployment-plan.md) — kolejne fazy (n8n, OpenClaw, KSeF).
