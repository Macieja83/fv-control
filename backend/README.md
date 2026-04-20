# FVControl API (Fastify + Prisma)

Backend platformy **FVControl**: wieloźródłowe pobieranie i przetwarzanie faktur (ingestion + pipeline + deduplikacja + webhooks), z pełnym modelem pod **Resta** jako filtr lub **samodzielną aplikację**. Stos: **Fastify**, **PostgreSQL**, **Prisma**, **Redis + BullMQ**, **S3/MinIO**, **OpenAPI**, **Vitest**.

Szczegóły produkcyjne: [README-PRODUCTION.md](./README-PRODUCTION.md). Dokumentacja: [docs/architecture.md](./docs/architecture.md).

## Wymagania

- Node.js **20+**
- Docker (opcjonalnie: PostgreSQL + API)
- `make` (opcjonalnie; komendy są też w `package.json`)

## Szybki start (lokalnie)

1. Skopiuj `.env.example` → `.env` i uzupełnij sekrety (`JWT_*`, `ENCRYPTION_KEY`).

2. Uruchom infrastrukturę (z katalogu `backend`):

   ```bash
   docker compose up -d postgres redis
   ```

3. Migracje i seed:

   ```bash
   npm install
   npm run prisma:generate
   npm run prisma:migrate
   npm run prisma:seed
   ```

4. Serwer deweloperski + worker (pipeline):

   ```bash
   npm run dev
   # osobny terminal:
   npm run worker
   ```

- API: `http://localhost:3000/api/v1`
- OpenAPI / Swagger UI: `http://localhost:3000/docs`
- Liveness: `GET http://localhost:3000/api/v1/health`
- Readiness: `GET http://localhost:3000/api/v1/ready`
- Metrics: `GET http://localhost:3000/metrics`

### Konto z seeda (tylko dev)

- E-mail: `admin@fvresta.local`
- Hasło: `Admin123!`
- Tenant: **Resta Demo** (wraz z przykładowym kontrahentem i fakturą + 2 pozycjami)

## Docker (Postgres + Redis + MinIO; API + Worker opcjonalnie w kontenerach)

Domyślnie uruchamiane są tylko bazy i MinIO (API i worker na hoście — `npm run dev` / `npm run worker`):

```bash
docker compose up -d
```

Pełny backend w kontenerach (API + worker — profil `docker-app`):

```bash
docker compose --profile docker-app up -d --build
```

- **api** — `migrate deploy` + `node dist/index.js`
- **worker** — `node dist/worker.js`

**Produkcja z API/worker w systemd:** nie uruchamiaj profilu `docker-app` na tym samym hoście — drugi worker w Dockerze weźmie te same joby z Redis, ale inny katalog uploadów i OCR się wyłoży.

Seed (jednorazowo / po zmianach, gdy działa kontener `api`):

```bash
docker compose --profile docker-app exec api npx prisma db seed
```

## Makefile

| Cel       | Komenda      |
|----------|--------------|
| Dev      | `make dev`   |
| Testy    | `make test`  |
| Lint     | `make lint`  |
| Migracje | `make migrate` |
| Seed     | `make seed`  |

## Architektura

- **`src/routes/*`** — rejestracja endpointów HTTP, walidacja wejścia (Zod), wywołania serwisów.
- **`src/modules/*`** — logika domenowa (auth, kontrahenci, faktury, pliki, integracje) + schematy Zod.
- **`src/plugins/*`** — Prisma, auth (JWT bearer), Swagger, globalny error handler, request id + log odpowiedzi.
- **`src/lib/*`** — JWT, Argon2, szyfrowanie kluczy POS, role, pomocnicze typy.
- **`prisma/`** — modele, migracje, seed.

Przepływ autoryzacji: **access token** (JWT, ~15 min) w nagłówku `Authorization: Bearer …`; **refresh token** (losowy, hash SHA-256 w tabeli `RefreshToken`) z rotacją przy `/api/v1/auth/refresh`.

Integracja POS nie dotyka tabel POS — wyłącznie HTTP do `baseUrl` konfigurowanego per tenant (`integrations_pos`), klucz API szyfrowany **AES-256-GCM**.

## Przykładowe `curl`

Zobacz też **[`docs/http-examples.md`](docs/http-examples.md)**.

### Login

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@fvresta.local\",\"password\":\"Admin123!\"}"
```

Zapisz `accessToken` i użyj:

```bash
export TOKEN="…accessToken…"
```

### Lista faktur

```bash
curl -s "http://localhost:3000/api/invoices?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

### Utworzenie faktury (bez pozycji — podajesz sumy)

```bash
curl -s -X POST http://localhost:3000/api/invoices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"contractorId\":\"UUID_KONTRAHENTA\",
    \"number\":\"FV/2026/042\",
    \"issueDate\":\"2026-04-01\",
    \"netTotal\":\"100.00\",
    \"vatTotal\":\"23.00\",
    \"grossTotal\":\"123.00\",
    \"status\":\"DRAFT\"
  }"
```

(`contractorId` weź z `GET /api/contractors`.)

## Skrypty npm

| Skrypt | Opis |
|--------|------|
| `dev` | `tsx watch src/index.ts` |
| `build` | kompilacja do `dist/` |
| `start` | `node dist/index.js` |
| `test` / `test:watch` | Vitest |
| `lint` | ESLint |
| `prisma:generate` | generacja klienta |
| `prisma:migrate` | `prisma migrate dev` |
| `prisma:seed` | seed |

## Bezpieczeństwo (skrót)

- Hasła: **Argon2id**
- JWT access + refresh (refresh w DB, rotacja)
- Rate limit na **`POST /api/auth/login`**
- **Helmet**, CORS z allowlisty env
- Brak logowania haseł i tokenów (nagłówki wrażliwe redagowane w logu odpowiedzi)

## TODO pod produkcję

- **S3** (lub kompatybilny object storage) dla `invoice_files`, podpisywane URL-e, skan antywirusowy.
- **RBAC granularny** (np. osobne uprawnienia do eksportu, usuwania faktur, integracji).
- **Audit hardening**: retention zdarzeń przy usuwaniu faktury, WORM / append-only, korelacja z SIEM.
- **Backup policy**: PITR Postgres, testy odtwarzania, szyfrowanie kopii.
- **Observability**: metryki RED/USE, rozproszone śledzenie (OpenTelemetry), alerty na SLO.
