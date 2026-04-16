# Go-Live status (aktualny)

Stan na teraz po wdrożeniach z audytu.

## 1) Zamknięte w kodzie (DONE)

- [x] Wymuszenie `FEATURE_AI_EXTRACTION_MOCK=false` w `production` (fail-fast).
- [x] Usunięto zależność od n8n / `webhooks_outbox` (brak wychodzących webhooków automatyzacji).
- [x] Ochrona `/metrics` + wymagany `METRICS_BEARER_TOKEN` w `production`.
- [x] Dodatkowe rate-limity auth: `register`, `refresh`, `verify-email`, `resend-verification`.
- [x] Idempotencja webhooków billingowych (Stripe/P24) po `eventId`.
- [x] Jawny typ tokenu impersonacji (`typ=impersonation`) + walidacja.
- [x] Limiter ręcznego KSeF sync przez Redis (fallback in-memory).
- [x] Verify-email z linku (`/verify?token=...`) po stronie frontu.
- [x] Guided onboarding banner/checklista tenantów w dashboardzie.
- [x] Smoke scripts:
  - [x] `smoke:tenant-journey`
  - [x] `smoke:ksef-readiness`

## 2) Do wykonania operacyjnie przed GO-LIVE (BLOCKER)

- [ ] Wdrożyć migracje na staging/prod (`prisma migrate deploy`) tak, by istniała tabela `billing_webhook_events`.
- [ ] Ustawić produkcyjne sekrety i potwierdzić ich poprawność:
  - [ ] `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
  - [ ] `ENCRYPTION_KEY` (base64 32B)
  - [ ] (pominięte) `WEBHOOK_SIGNING_SECRET` — nie jest już wymagane w konfiguracji produkcyjnej
  - [ ] `METRICS_BEARER_TOKEN`
  - [ ] `STRIPE_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO`
- [ ] Ograniczyć dostęp do `/metrics` na poziomie ingress (allowlist/private).
- [ ] Potwierdzić ciągłą pracę workerów (BullMQ + housekeeping) i wspólny Redis.
- [ ] Przejść pełny UAT tenant journey na staging.
- [ ] Przeprowadzić backup + restore test i potwierdzić RTO/RPO.

## 3) Wciąż otwarte po stronie jakości (NON-BLOCKER po starcie, ale ważne)

- [ ] Rozszerzyć integracyjne testy auth/register/verify o więcej edge-case.
- [ ] Dorzucić smoke z realnym webhook event replay test (Stripe CLI) w runbooku.
- [ ] Ujednolicić pozostałe moduły API pod wspólny klient błędów (tam, gdzie jeszcze lokalne helpery).
- [ ] Dodać alerty/progi SLO do monitoringu (konkretne progi 5xx, DLQ, ready).

## 4) Go / No-Go (decyzja)

**GO** dopiero gdy sekcja 2 jest w 100% odhaczona na staging i potwierdzona na produkcji.

## 5) Ostatnia weryfikacja lokalna (wykonana)

- [x] `npm run prisma:migrate:deploy` — migracja `20260416153000_billing_webhook_idempotency` zastosowana.
- [x] `npm run smoke:tenant-journey` — PASS.
- [x] `npm run smoke:ksef-readiness` (z `SMOKE_ALLOW_KSEF_MISSING=1`) — PASS, środowisko KSeF=`mock`.
- [x] Endpointy:
  - [x] `GET /api/v1/health` -> 200
  - [x] `GET /api/v1/ready` -> 200 (database=ok, redis=ok)
  - [x] `GET /api/v1/version` -> 200
  - [x] `GET /metrics` -> 200 (lokalne dev bez tokena w shell env)

