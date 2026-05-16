# FV Control — Plan Go-To-Market

> Data audytu: 2026-05-07
> Cel: doprowadzić aplikację do stanu live-sales na rynku PL B2B (HoReCa + małe/średnie firmy).

## TL;DR — co masz vs co brakuje

**Aplikacja jest dalej niż się wydawało.** Działa: auth self-service + email verify + password reset + Google OAuth, multi-tenant pełna izolacja DB, Stripe billing (inbound webhooks z signature + idempotencją), KSeF v2 client (RSA-OAEP + XAdES, gotowy ale w sandbox), 50-70+ testów + CI workflow, frontend ma landing page + mobile capture + dashboard.

**Główne luki blockujące sprzedaż:**
1. Legal placeholdery (regulamin + polityka prywatności = template)
2. Brak ops produkcyjnych (domena, SSL, nginx, backup)
3. Sekrety i SMTP nieskonfigurowane na prod
4. Connectors Gmail/IMAP/Resta = stuby (Zenbox IMAP działa, KSeF receive częściowy)
5. AI extraction = mock (`FEATURE_AI_EXTRACTION_MOCK=true`)
6. Brak cookie consent + analytics
7. Pricing page brakuje (subskrypcja jest w kodzie)

---

## 🔴 BLOCKERY — bez tego nie ruszasz live

### LEGAL / RODO
- [ ] **B1.** Wypełnić regulamin SaaS PL — `src/legal/PlaceholderLegalPage.tsx` (placeholder). Wymagane: TT Grupa identyfikacja, cennik, prawo odstąpienia konsumenta 14 dni, SLA, prawo właściwe
- [ ] **B2.** Wypełnić politykę prywatności (RODO) — administrator danych, podstawy prawne art. 6 RODO, retencja, prawa osoby
- [ ] **B3.** Lista podprocesorów + DPA — Stripe, Hostinger, OpenAI (jeśli używane), MinIO. Strona "podprocesorzy" + podpisane DPA
- [ ] **B4.** Cookie consent banner — granular: necessary/analytics/marketing. Brak w kodzie obecnie

### INFRA / DEPLOY
- [ ] **B5.** Domena + DNS + nginx reverse proxy + Let's Encrypt SSL — VPS Hostinger 100.91.71.54 jest Tailscale-only, potrzebny publiczny endpoint
- [ ] **B6.** Sekrety produkcyjne — `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` (base64 32B), `METRICS_BEARER_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO`. Vault/SOPS lub minimum systemd EnvFile 600
- [ ] **B7.** SMTP produkcyjny — `auth.service.ts:41-45` failuje rejestrację bez SMTP. Setup: SES/Mailgun/Resend + SPF/DKIM/DMARC dla domeny
- [ ] **B8.** Backup Postgres + restore test — `pg_dump` cron + offsite (B2/R2) + sprawdzony restore na staging. RPO/RTO udokumentowane
- [ ] **B9.** Migracje na prod — `npx prisma migrate deploy` na API + worker, w tym `billing_webhook_events`
- [ ] **B10.** `/metrics` allowlist na nginx — token jest, ale dodatkowo IP/Tailscale only

### KSeF / COMPLIANCE
- [ ] **B11.** Decyzja KSeF env per tenant — od 02.2026 obowiązkowy w PL. PRO klienci muszą mieć production. Verify end-to-end credential storage (`ksef-tenant-credentials.service.ts`)
- [ ] **B12.** TT Grupa rejestracja w MF jako wystawca/odbiorca KSeF + własny token + dokumentacja onboardingu klienta
- [ ] **B13.** KSeF send mode — przełącz `KSEF_ISSUANCE_MODE` ze `stub` na `live` w prod, lub jasno komunikuj klientom że to MVP receive-only

### BILLING / FINANSE
- [ ] **B14.** Test Stripe webhook end-to-end na staging — `stripe trigger invoice.paid` + `customer.subscription.deleted`. Replay idempotency runbookiem
- [ ] **B15.** Faktura VAT za własny SaaS — TT Grupa wystawia FV za subskrypcję klientom. Stripe Invoicing albo Fakturownia API + księgowy. PIT/VAT setup przed pierwszą sprzedażą

### AI
- [ ] **B16.** AI extraction decyzja — albo `FEATURE_AI_EXTRACTION_MOCK=false` + realny adapter OpenAI (`adapters/ai/ai-invoice.adapter.ts` + `OPENAI_API_KEY` + budget cap per tenant), albo wyłącz feature i sprzedawaj bez AI (manual entry/upload + KSeF)

---

## 🟡 MUST-HAVE pierwszy płacący klient

### PRODUKT / UX
- [ ] **M1.** CTA na landing → register z UTM tracking (`src/landing/LandingPage.tsx`)
- [ ] **M2.** Pricing page — Free 15 slotów / PRO `PRO_PLAN_PRICE_PLN` zł/mies + FAQ
- [ ] **M3.** Onboarding wizard — sprawdzić kroki: NIP + GUS BIR autocomplete (`gus-bir.service.ts` jest), KSeF token, pierwsza FV, upgrade PRO (`OnboardingChecklistBanner.tsx`)
- [ ] **M4.** Demo data / sandbox tenant — przycisk "wypróbuj demo" lub seed dla nowego konta (rozszerz `prisma/seed.ts`)
- [ ] **M5.** i18n PL audit error messages backendu (`auth.service.ts` ma "Email already exists" ENG → PL)
- [ ] **M6.** Statusy płatności w UI + przyciski "pobierz fakturę PDF" (`PaymentsPanel.tsx`)
- [ ] **M7.** Cancel/upgrade flow — Stripe Customer Portal link w settings

### MAILE TRANSAKCYJNE
- [ ] **M8.** Szablony PL: verify-email, password reset, payment success, payment failed, subscription canceled

### MARKETING / ANALYTICS
- [ ] **M9.** Google Analytics / Plausible — po cookie consent, mierz signup funnel
- [ ] **M10.** Public-facing screencast / GIF — landing ma symulowane animacje, dodaj realne demo nagranie w hero
- [ ] **M11.** SEO basics — meta tags, sitemap.xml, robots.txt

### SUPPORT / OPS
- [ ] **M12.** Status page — statuspage.io (free) lub Uptime Kuma na VPS. Link w stopce
- [ ] **M13.** Helpdesk + SLA — Crisp free / FreeScout self-host. `kontakt@tuttopizza.pl` jest w landingu
- [ ] **M14.** Logi w prod — Pino + logrotate + opcjonalnie Loki na VPS
- [ ] **M15.** Alerty Prometheus — `/ready != 200 > 5min`, `processing_jobs DEAD_LETTER > 0`, 5xx rate
- [ ] **M16.** Smoke tests w CI deploy — dodaj po-deploy `smoke:tenant-journey` + `smoke:ksef-readiness`

---

## 🟢 NICE-TO-HAVE — iteracja po launchu

- [ ] **N1.** AI extraction realny — wymiana mocka na OpenAI/Anthropic z budget per tenant
- [ ] **N2.** Resta POS connector (Stage 3) — dla HoReCa target, ale nie blocker
- [ ] **N3.** Gmail OAuth ingest (Stage 2) — Zenbox IMAP już działa
- [ ] **N4.** PWA mobilna — `MobileInvoiceCapturePage.tsx` jest, dodaj manifest + offline cache
- [ ] **N5.** SEO / blog — /blog z artykułami "KSeF od 2026"
- [ ] **N6.** DLQ UI dla admina — `processing_jobs` w stanie DEAD_LETTER widoczne tylko w `/metrics`
- [ ] **N7.** Affiliate / referral z kuponem Stripe
- [ ] **N8.** MFA / 2FA (TOTP) — obecnie tylko JWT
- [ ] **N9.** Outbound webhooks (klienci → ich systemy) — moduł pusty
- [ ] **N10.** SOC 2 lite / ISO27001 readiness — dla większych B2B później

---

## Pliki krytyczne do edycji

- `src/legal/PlaceholderLegalPage.tsx` — regulamin + polityka prywatności
- `src/landing/LandingPage.tsx` — CTA + pricing + demo
- `backend/src/modules/billing/subscription-plans.ts` — plany cenowe
- `backend/src/modules/auth/auth.service.ts` — error messages PL, SMTP wymóg
- `backend/docs/go-live-checklist.md` — checklist produkcyjny (jest!)
- `backend/.env.staging.example` — szablon prod env

## Sugerowana kolejność (3 sprinty po ~tydzień)

**Sprint 1 — fundament prawny + infra (B1-B10):** legal + domena/SSL/nginx + sekrety + SMTP + backup. Bez tego nie ma sensu nic dalej.

**Sprint 2 — KSeF + billing live (B11-B16):** dokończenie KSeF prod, faktury VAT za SaaS, Stripe end-to-end, decyzja AI mock vs real.

**Sprint 3 — UX + first customer (M1-M16):** pricing, onboarding, demo, screencast, status page, alerty. Pierwszy płacący klient pod koniec.

Po Sprint 3 = możesz zacząć sprzedaż. NICE-TO-HAVE iterujesz w tle.
