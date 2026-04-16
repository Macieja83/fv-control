# Go-Live checklist (D-7 -> D-Day)

Ten dokument jest listą **go/no-go** pod start sprzedaży subskrypcji.

## D-7: konfiguracja i bezpieczeństwo

- [ ] Ustaw `NODE_ENV=production`.
- [ ] Ustaw `FEATURE_AI_EXTRACTION_MOCK=false` (w prod start API powinien failować, jeśli true).
- [ ] Ustaw silne sekrety: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.
- [ ] Ustaw `ENCRYPTION_KEY` jako base64 32B.
- [ ] Ustaw `WEBHOOK_SIGNING_SECRET` (inbound podpisy webhooków).
- [ ] Ustaw `METRICS_BEARER_TOKEN` i ogranicz `/metrics` w ingress (private/alowlist).
- [ ] Ustaw `PLATFORM_ADMIN_EMAIL`.
- [ ] Zweryfikuj `CORS_ORIGINS` tylko dla produkcyjnych domen.

## D-6: billing i webhooki

- [ ] Ustaw `STRIPE_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO`.
- [ ] Stripe webhook endpoint: `/api/v1/billing/webhooks/stripe`.
- [ ] Zweryfikuj replay idempotency (ten sam event nie aktualizuje subskrypcji drugi raz).
- [ ] Potwierdź, że eventy `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted` mapują status poprawnie.

## D-5: baza i migracje

- [ ] `npx prisma migrate deploy` na API.
- [ ] `npx prisma migrate deploy` na worker.
- [ ] Potwierdź obecność nowych tabel (m.in. `billing_webhook_events`).
- [ ] Smoke DB: login, odczyt `/ready`, zapis testowej faktury.

## D-4: kolejki, worker, KSeF

- [ ] Worker uruchomiony stale (BullMQ + housekeeping).
- [ ] Redis dostępny i wspólny dla API/worker (`REDIS_URL`, `BULLMQ_PREFIX`).
- [ ] Ręczny sync KSeF limitowany globalnie (Redis limiter).
- [ ] Tenant onboarding KSeF: zapis poświadczeń -> test połączenia -> sync.

## D-3: monitoring i alerty

- [ ] Dashboard metryk: 5xx, latency, dead-letter webhooków, queue health.
- [ ] Alerty:
  - [ ] `/ready != 200` > X minut,
  - [ ] rosnące `fvcontrol_webhook_dead_letter_total`,
  - [ ] skok 401/403 auth.
- [ ] Zespół zna runbooki z `docs/runbooks.md`.

## D-2: UAT tenant journey

- [ ] Rejestracja tenanta (free/pro).
- [ ] Verify-email link z tokenem (`/verify?token=...`) działa bez ręcznego kopiowania.
- [ ] Uzupełnienie danych firmy i NIP.
- [ ] KSeF credentials + test połączenia + pierwsza synchronizacja.
- [ ] Zakup / aktywacja PRO przez Stripe.
- [ ] Widok faktur i raportów działa po pełnym onboardingu.

## D-1: backup / restore i rollback

- [ ] Backup DB wykonany i zweryfikowany.
- [ ] Test restore na środowisku staging.
- [ ] Plan rollback: aplikacja + migracje (procedura awaryjna).
- [ ] Potwierdzone osoby on-call na dzień startu.

## D-Day: smoke po wdrożeniu

- [ ] `GET /health`, `GET /ready`, `GET /version` OK.
- [ ] `GET /metrics` z tokenem działa; bez tokenu -> 401.
- [ ] Logowanie tenant i operatora platformy działa.
- [ ] Billing webhook test event przechodzi i nie duplikuje stanu.
- [ ] KSeF sync można uruchomić i obserwować telemetry.
- [ ] Uruchom smoke skrypty:
  - [ ] `npm run smoke:tenant-journey` (rejestracja -> verify -> login -> /auth/me),
  - [ ] `npm run smoke:ksef-readiness` (login -> KSeF status -> test połączenia).

## Go / No-Go kryteria

**Go** tylko jeśli:
- wszystkie punkty D-7..D-Day oznaczone,
- brak otwartych Critical i High z audytu,
- monitoring i on-call aktywne.

**No-Go** jeśli:
- którykolwiek sekret krytyczny brak,
- migracje nieprzetestowane na staging,
- brak działającego worker/queue,
- brak potwierdzonego backup+restore.

