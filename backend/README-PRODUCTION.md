# FVControl — production-ready setup

## Why Fastify (not NestJS)

We standardize on **Fastify** for the API tier: lower overhead, first-class schema/OpenAPI hooks, and a plugin model that maps cleanly to **bounded modules** (auth, ingestion, pipeline, webhooks). NestJS remains a valid choice if you prefer DI-heavy, decorator-first code; migrating would mostly re-home the same **domain** and **adapter** folders behind Nest modules.

## Repository tree (backend)

```text
backend/
├── prisma/
│   ├── schema.prisma          # Full FVControl model + RBAC + pipeline tables
│   ├── migrations/            # Includes pg_trgm + platform migration
│   └── seed.ts                # Demo tenant, RBAC, mailboxes, ingestion sources
├── src/
│   ├── adapters/              # AI mock, S3/local storage
│   ├── connectors/            # Connector interfaces + stubs + contract tests
│   ├── domain/deduplication/  # Fingerprint + duplicate scoring (unit tested)
│   ├── jobs/                  # (queue constants; worker entry at worker.ts)
│   ├── lib/                   # Redis, metrics, crypto helpers, errors
│   ├── modules/               # Services: auth, invoices, pipeline, dashboard, …
│   ├── plugins/               # Prisma, auth, swagger, errors, request context
│   ├── routes/                # HTTP /api/v1/* (+ metrics on /metrics)
│   ├── app.ts
│   ├── index.ts               # API process
│   └── worker.ts              # BullMQ consumer
├── docker-compose.yml         # postgres, redis, minio, api, worker
├── Dockerfile
├── docs/                      # architecture, data model, connectors, runbooks, n8n, rollout
└── package.json
```

## Production checklist

1. **Secrets:** rotate `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `WEBHOOK_SIGNING_SECRET`, connector credentials; store in a secret manager.
2. **Database:** managed PostgreSQL, backups, PITR; run `prisma migrate deploy` in CI/CD.
3. **Redis:** managed Redis with persistence if you require job durability beyond Postgres job rows.
4. **Object storage:** `STORAGE_DRIVER=s3` with private bucket; SSE-KMS if required.
5. **Networking:** TLS termination at ingress; restrict admin routes by IP/VPN if needed.
6. **Observability:** scrape `/metrics`; ship JSON logs; alert on `/ready` failures and DLQ growth.
7. **CORS:** set `CORS_ORIGINS` to real UI origins only.
8. **Workers:** run **at least one** `worker` replica; scale horizontally with shared Redis.

## Processes

| Process | Command |
|---------|---------|
| API | `node dist/index.js` (after `npm run build`) |
| Worker | `node dist/worker.js` |
| Migrations | `npx prisma migrate deploy` |

Docker Compose runs migrations for **api** and **worker** startup commands (see `docker-compose.yml`).

## Frontend (nginx static root)

Jeśli produkcyjny UI jest pod **nginx** z `root` innym niż katalog `dist/` z buildu (np. **fv.resta.biz** → `/var/www/fv-control`), po `npm run build` w korzeniu repozytorium uruchom **`./scripts/deploy-fv-www.sh`** (zob. [deploy-systemd-api-and-worker.md](./docs/deploy-systemd-api-and-worker.md)).

## Smoke tests after deploy

```bash
curl -sSf http://<host>/api/v1/health
curl -sSf http://<host>/api/v1/ready
curl -sSf http://<host>/metrics | head
```

Authenticated flows: login via `POST /api/v1/auth/login`, then `GET /api/v1/dashboard/summary` with `Authorization: Bearer …`.
