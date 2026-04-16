/**
 * Checklista wdrożenia (produkcja + pilot + sprzedaż) — wypisuje kroki na stdout.
 * Użycie: npx tsx scripts/print-go-live-checklist.ts
 */
const lines = [
  "=== FV Control — checklista go-live ===",
  "",
  "A. Środowiska: staging + production; sekrety tylko w vault / zmiennych hosta.",
  "B. Deploy: API + worker + Postgres + Redis; migracje Prisma raz przy starcie API (Dockerfile CMD).",
  "C. Stripe staging: sk_test + webhook test + checkout → rekord subskrypcji w DB.",
  "D. Stripe live: sk_live + STRIPE_PRICE_ID_PRO + webhook /api/v1/billing/webhooks/stripe (whsec_).",
  "E. KSeF: KSEF_DISABLE_GLOBAL_FALLBACK=true; staging=sandbox MF; prod=production po akceptacji MF.",
  "F. QA: rejestracja → weryfikacja e-mail; Google → ustaw hasło w Ustawieniach; NIP 10 cyfr; KSeF zapis + test + sync.",
  "G. Pilot: 3–5 firm, 2 tygodnie, poprawki.",
  "H. Publicznie: landing + regulamin (treść prawna) + polityka prywatności + kanał support.",
  "I. Po starcie: metryki lejka (rejestracja → KSeF → PRO), backupy, przegląd kosztów (OpenAI, hosting, Stripe).",
  "",
  "Skrypty pomocnicze:",
  "  npm run verify:production-readiness -- --strict",
  "  npm run verify:billing-config -- --expect-live   # lub --expect-test",
  "",
];

console.log(lines.join("\n"));
