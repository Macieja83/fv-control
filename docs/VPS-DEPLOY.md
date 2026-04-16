# Wdrożenie na VPS (FV Control)

Dwa typowe warianty: **(A) cały stack w Dockerze** (`backend/docker-compose.yml`) albo **(B) tylko Postgres + Redis w Dockerze**, API + worker przez systemd (zob. [backend/docs/deploy-systemd-api-and-worker.md](../backend/docs/deploy-systemd-api-and-worker.md)).

---

## Wymagania

- Docker Engine + Compose v2 (najlepiej 2.24+ — obsługa `env_file` z `required: false`).
- Na VPS: **ufw** / firewall — domyślnie **nie** wystawiaj Postgresa i Redis publicznie (porty 5432/6379); ogranicz dostęp lub usuń publikację portów w compose (tylko sieć Dockera).
- Domeny z **TLS** (np. Caddy lub nginx + certbot).
- Plik **`backend/.env`** utworzony z szablonu (patrz niżej) — **nigdy** nie commituj prawdziwego `.env`.

---

## (A) Pełny stack Docker (`backend/`)

1. Sklonuj repozytorium na serwer.
2. W katalogu `backend/`:
   ```bash
   cp .env.production.example .env
   ```
   Uzupełnij m.in.: `DATABASE_URL` (jeśli używasz kontenera `postgres` z compose, zostaw w formie  
   `postgresql://fvresta:TWOJE_HASLO@postgres:5432/fvresta?schema=public` i **zmień** `POSTGRES_PASSWORD` w `docker-compose.yml` + spójnie w URL), `JWT_*`, `ENCRYPTION_KEY` (32 bajty base64), `REDIS_URL`, `CORS_ORIGINS`, `WEB_APP_URL`, `METRICS_BEARER_TOKEN` (≥24 zn.), `OPENAI_API_KEY`, Stripe (`STRIPE_*`), Google OAuth, KSeF (`KSEF_ENV`, `KSEF_DISABLE_GLOBAL_FALLBACK=true` dla SaaS), S3 jeśli `STORAGE_DRIVER=s3`.
3. Zbuduj i uruchom:
   ```bash
   docker compose build --no-cache
   docker compose up -d
   ```
4. Sprawdź:
   ```bash
   curl -sS http://127.0.0.1:3000/api/v1/health
   curl -sS http://127.0.0.1:3000/api/v1/ready
   ```
5. **Stripe webhook** (Live): URL publiczny musi trafiać do API, np.  
   `https://twoja-domena/api/v1/billing/webhooks/stripe` (nginx → port 3000, ścieżka `/api/`).

Migracje uruchamia się przy **starcie kontenera `api`** (Dockerfile). Worker startuje po `api` (healthy).

---

## Frontend (Vite) + nginx

Aplikacja woła API pod ścieżką względną **`/api/v1`** — nginx musi **proxy** `location /api/` na proces API (np. `http://127.0.0.1:3000`).

1. Na **build machine** lub na VPS, w **korzeniu repozytorium**:
   ```bash
   npm ci
   npm run build
   ```
2. Wgraj statyczny build na serwer (np. skrypt z repo):
   ```bash
   sudo mkdir -p /var/www/fv-control
   ./scripts/deploy-fv-www.sh
   ```
   (lub `FV_WWW_ROOT=/ścieżka ./scripts/deploy-fv-www.sh`).
3. Skonfiguruj nginx — przykład: [deploy/nginx-fv-control.example.conf](../deploy/nginx-fv-control.example.conf) (dostosuj `server_name`, ścieżki, upstream).

`WEB_APP_URL` i `CORS_ORIGINS` w `backend/.env` muszą wskazywać **publiczny URL frontu** (https).

---

## Weryfikacja przed „go live”

Z katalogu `backend/` (z ustawionymi zmiennymi jak na serwerze lub z załadowanym `.env`):

```bash
npm run verify:production-readiness -- --strict
npm run verify:billing-config -- --expect-live
npm run print:go-live-checklist
```

---

## Szablony zmiennych w repozytorium

- [`backend/.env.example`](../backend/.env.example) — pełna lista pól.
- [`backend/.env.staging.example`](../backend/.env.staging.example) — staging (Stripe test, sandbox KSeF).
- [`backend/.env.production.example`](../backend/.env.production.example) — produkcja.

Skopiuj odpowiedni plik do `backend/.env` na serwerze i edytuj.

---

## MinIO

`docker-compose.yml` zawiera MinIO do dev/S3-compatible. Na produkcji często wyłącza się MinIO i używa **prawdziwego S3** — wtedy dostosuj usługi w compose (lub osobny plik override) i zmienne `S3_*` w `.env`.
