/**
 * Szybki audyt zmiennych przed produkcją (bez uruchamiania serwera).
 * Użycie: npx tsx scripts/verify-production-readiness.ts --strict
 */
import { Buffer } from "node:buffer";

function fail(msg: string): never {
  console.error(`[verify-production-readiness] ${msg}`);
  process.exit(1);
}

function warn(msg: string) {
  console.warn(`[verify-production-readiness] UWAGA: ${msg}`);
}

function main() {
  const strict = process.argv.includes("--strict");
  if (!strict) {
    console.log(
      "[verify-production-readiness] Uruchom z --strict przed deployem na produkcję, np.:\n" +
        "  npx tsx scripts/verify-production-readiness.ts --strict",
    );
    process.exit(0);
  }

  const enc = process.env.ENCRYPTION_KEY?.trim() ?? "";
  try {
    if (Buffer.from(enc, "base64").length !== 32) fail("ENCRYPTION_KEY musi być base64 dokładnie 32 bajtów.");
  } catch {
    fail("ENCRYPTION_KEY nie jest poprawnym base64.");
  }

  const ja = process.env.JWT_ACCESS_SECRET?.trim() ?? "";
  const jr = process.env.JWT_REFRESH_SECRET?.trim() ?? "";
  if (ja.length < 32) fail("JWT_ACCESS_SECRET min. 32 znaki.");
  if (jr.length < 32) fail("JWT_REFRESH_SECRET min. 32 znaki.");
  if (ja === jr) warn("JWT_ACCESS_SECRET i JWT_REFRESH_SECRET powinny być różne.");

  const cors = process.env.CORS_ORIGINS ?? "";
  if (cors.toLowerCase().includes("localhost")) {
    warn("CORS_ORIGINS zawiera localhost — na produkcji ustaw wyłącznie domeny publiczne.");
  }

  const web = process.env.WEB_APP_URL?.trim() ?? "";
  if (!web.startsWith("https://")) warn("WEB_APP_URL powinien używać https:// na produkcji.");

  const smtpHost = process.env.SMTP_HOST?.trim() ?? "";
  if (!smtpHost) fail("SMTP_HOST jest wymagany do wysyłki linków weryfikacyjnych (rejestracja e-mail i Google).");

  const ksefNoGlobal = process.env.KSEF_DISABLE_GLOBAL_FALLBACK === "true";
  if (!ksefNoGlobal) {
    warn("Ustaw KSEF_DISABLE_GLOBAL_FALLBACK=true dla SaaS wielotenancyjnego (bez globalnego KSEF_TOKEN dla klientów).");
  }

  const metrics = process.env.METRICS_BEARER_TOKEN?.trim() ?? "";
  if (metrics.length < 24) fail("METRICS_BEARER_TOKEN wymagany (min. 24 znaki) przy NODE_ENV=production w runtime — ustaw przed startem API.");

  console.log("[verify-production-readiness] Zmienne krytyczne wyglądają poprawnie (poziomy aplikacji).");
  console.log("  Poza kodem: MFA na koncie hostingu/DB, backup Postgres + test odtworzenia, brak sekretów w logach.");
  process.exit(0);
}

main();
