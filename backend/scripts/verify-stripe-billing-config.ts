/**
 * Weryfikuje zmienne Stripe pod billing (subskrypcja PRO).
 * Użycie:
 *   npx tsx scripts/verify-stripe-billing-config.ts --expect-test   # staging (sk_test + whsec z test webhook)
 *   npx tsx scripts/verify-stripe-billing-config.ts --expect-live  # produkcja (sk_live + whsec live)
 */
function fail(msg: string): never {
  console.error(`[verify-stripe-billing-config] ${msg}`);
  process.exit(1);
}

function main() {
  const expectTest = process.argv.includes("--expect-test");
  const expectLive = process.argv.includes("--expect-live");
  if (!expectTest && !expectLive) {
    console.log(
      "[verify-stripe-billing-config] Pominięto (podaj --expect-test lub --expect-live). Przykład:\n" +
        "  npx tsx scripts/verify-stripe-billing-config.ts --expect-live",
    );
    process.exit(0);
  }

  const sk = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const price = process.env.STRIPE_PRICE_ID_PRO?.trim() ?? "";
  const wh = process.env.STRIPE_BILLING_WEBHOOK_SECRET?.trim() ?? "";

  if (!sk) fail("Brak STRIPE_SECRET_KEY.");
  if (!price || !price.startsWith("price_")) fail("Brak STRIPE_PRICE_ID_PRO lub nie zaczyna się od price_.");
  if (!wh || !wh.startsWith("whsec_")) fail("Brak STRIPE_BILLING_WEBHOOK_SECRET lub nie zaczyna się od whsec_.");

  if (expectLive) {
    if (!sk.startsWith("sk_live_")) fail("Tryb --expect-live: STRIPE_SECRET_KEY musi zaczynać się od sk_live_.");
    console.log("[verify-stripe-billing-config] OK (Stripe LIVE + webhook + price id).");
    console.log(
      "  Upewnij się, że endpoint https://<host-api>/api/v1/billing/webhooks/stripe jest zarejestrowany w Stripe (eventy subscription + invoice).",
    );
    process.exit(0);
  }

  if (!sk.startsWith("sk_test_")) fail("Tryb --expect-test: STRIPE_SECRET_KEY musi zaczynać się od sk_test_.");
  console.log("[verify-stripe-billing-config] OK (Stripe TEST + webhook + price id).");
  process.exit(0);
}

main();
