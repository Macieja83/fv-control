# OpenClaw (Discord) + n8n — integracja hybrydowa z FV Control

FV Control zostaje **jednym systemem prawdy** dla faktur (ingestia, pipeline, duplikaty, compliance). **OpenClaw** obsługuje **kanał ludzki** (Discord: czat, załączniki). **n8n** obsługuje **automatykę w tle** (zdarzenia z FV, harmonogramy, wiele kroków bez LLM).

## Kto za co odpowiada

| Potrzeba | Narzędzie | Uwagi |
|----------|-----------|--------|
| Wrzucenie zdjęcia/PDF na Discord → faktura w aplikacji | **OpenClaw** | Agent pobiera załącznik i woła REST FV Control (np. upload). |
| Pytania w stylu „pokaż faktury od X / co z duplikatem?” | **OpenClaw** | Agent tłumaczy intencję i woła **GET** listy/szczegółu lub streści wynik. |
| Powiadomienia po przetworzeniu, cron, KSeF poll (gdy będzie), łańcuchy ERP | **n8n** | Już opisane: [n8n-integration.md](./n8n-integration.md) (outbound webhooki, inbound do FV). |
| Duplikaty i zgodność „same z siebie” po pliku | **FV Control** | Pipeline + eventy; agent tylko **czyta** stan z API lub Ty reagujesz w n8n na webhook. |

Hybryda oznacza: **OpenClaw nie zastępuje n8n** — uzupełnia go tam, gdzie jest **Discord i rozumowanie w rozmowie**.

## Przepływ: Discord → nowa faktura

1. Użytkownik wysyła na kanał/bota wiadomość z **załącznikiem** (PDF/JPEG/PNG).
2. **OpenClaw** (bot Discord) odbiera plik i wywołuje FV Control:
   - **`POST /api/v1/ingestion/manual-upload`** — `multipart/form-data`; route bierze **pierwszy plik** z żądania (`request.file()`), nazwa pola jest dowolna o ile wysyłasz jeden plik.
   - Nagłówek **`Authorization: Bearer <access_token>`**.
3. Odpowiedź **202/200** → worker uruchamia pipeline (ekstrakcja, dedup, compliance). Agent może na Discordzie potwierdzić **ID dokumentu / faktury** z JSON-a odpowiedzi (jeśli je zwraca serwis — sprawdź aktualny kształt odpowiedzi w Swaggerze `/docs`).

**Uprawnienia:** upload wymaga roli z prawem mutacji: **`OWNER`**, **`ADMIN`** lub **`ACCOUNTANT`** (patrz `assertCanMutate` w backendzie). Dla bota najlepiej **dedykowane konto użytkownika** („service”) w tym samym tenantcie — bez udostępniania hasła osobom.

**Tokeny:** uzyskaj **`access`** przez **`POST /api/v1/auth/login`** (jak w [n8n-integration.md](./n8n-integration.md) — sekcja *Auth for REST nodes*). Na VPS trzymaj login/hasło lub długotrwały refresh w sekretach OpenClaw; odnawiaj access token zgodnie z polityką wygaśnięcia.

## Przepływ: pytanie na Discordzie → dane z aplikacji

1. Użytkownik pyta w naturalnym języku.
2. Agent mapuje to na zapytania HTTP, np.:
   - **`GET /api/v1/invoices?limit=…&page=…`** (+ filtry dostępne w API),
   - ewentualnie szczegół pojedynczej faktury, jeśli macie na to route (Swagger `/docs`).
3. Agent **streszcza** wynik na czacie (nie wkleja całego JSON-a, o ile nie prosicie).

## Przepływ: FV Control → automatyzacja (bez Discorda)

Bez zmian w filozofii produktu:

- Outbound: kolejka **`webhooks_outbox`** → POST do URL n8n (podpis HMAC, retry) — [n8n-integration.md](./n8n-integration.md).
- Inbound: **`POST /api/v1/webhooks/inbound`** — n8n (lub inny orchestrator) **pcha** zdarzenia do FV, jeśli taki proces macie.

OpenClaw **może** wołać n8n Webhook jako narzędzie, jeśli chcecie centralizować logikę w workflow — to opcjonalna warstwa pośrednia, nie jest wymagana do samego uploadu z Discorda.

## Bezpieczeństwo (skrót)

- **Nie** wystawiaj publicznie tokenu bota w repozytorium frontu; sekrety tylko na VPS (OpenClaw / vault).
- FV Control: **HTTPS** w produkcji, silne hasło konta technicznego, ewentualnie osobny użytkownik tylko pod ingest + read.
- Jeśli kiedyś dodacie dedykowany endpoint „machine / bot”, nadal trzymajcie go za siecią prywatną lub z dodatkowym sekretem — do czasu tego momentu wystarczy JWT jak dla zwykłego użytkownika z wąską rolą (`ACCOUNTANT` + tylko potrzebne uprawnienia, gdy przejdziecie na permission-based RBAC).

## Checklist wdrożeniowy

1. Konto **`ACCOUNTANT`** (lub `ADMIN`) w tenantcie + hasło w sekrecie OpenClaw.
2. W agencie OpenClaw: narzędzie **HTTP** — base URL FV Control, login → bearer, upload multipart.
3. **`N8N_WEBHOOK_URL`** + worker na FV, jeśli macie odbierać eventy w n8n ([n8n-integration.md](./n8n-integration.md)).
4. Test: mały PDF z Discorda → pojawia się rekord w UI / lista **`GET /api/v1/invoices`**.

## Powiązane dokumenty

- [integration-deployment-plan.md](./integration-deployment-plan.md) — **kolejność wdrożenia** (najpierw poczta do FV, potem n8n, OpenClaw, KSeF).
- [n8n-integration.md](./n8n-integration.md) — webhooki, podpisy, auth REST.
- [architecture.md](./architecture.md) — pipeline, źródła danych.
- [security-hardening.md](./security-hardening.md) — HMAC, surowe body.
