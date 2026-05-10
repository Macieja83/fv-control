/**
 * B15 dogfood — ustaw dane firmowe klienta dla wystawienia FV VAT.
 *
 * Zapisuje `TenantSetting[billing_company_data]` JSON z: legalName, nip (10 cyfr),
 * address, invoiceEmail. Po tej operacji następna płatność subskrypcji klienta
 * triggeruje auto-wystawienie FV w tenancie TT Grupa
 * (commit 0513220 `feat(billing): B15 dogfood KSeF`).
 *
 * Użycie:
 *   npx tsx scripts/set-billing-company-data.ts \
 *     --tenant=<uuid_klienta> \
 *     --legal-name="Restauracja Alfa Sp. z o.o." \
 *     --nip=1234567890 \
 *     --address="ul. Krakowska 12, 30-123 Kraków" \
 *     --invoice-email=ksiegowosc@alfa.pl
 *
 * Idempotentny: upsert po `(tenantId, key)`.
 *
 * Alternatywa: w UI (gdy frontend modal NIP gotowy — Etap 3) klient sam wpisuje
 * dane przy upgrade na PRO. Ten script służy do bootstrapu pilotnych klientów lub
 * fixu danych dla istniejących tenantów.
 */

import { PrismaClient } from "@prisma/client";

const BILLING_COMPANY_DATA_SETTING_KEY = "billing_company_data";

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim();
  }
  return null;
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function main() {
  const tenantId = parseArg("tenant");
  const legalName = parseArg("legal-name");
  const nipRaw = parseArg("nip");
  const address = parseArg("address");
  const invoiceEmail = parseArg("invoice-email");

  const errors: string[] = [];
  if (!tenantId) errors.push("--tenant=<uuid> wymagane");
  else if (!isValidUuid(tenantId)) errors.push(`--tenant musi być UUID (dostałem '${tenantId}')`);
  if (!legalName || legalName.length < 3) errors.push("--legal-name=<str> wymagane (min 3 znaki)");
  const nip = (nipRaw ?? "").replace(/\D/g, "");
  if (nip.length !== 10) errors.push(`--nip musi mieć 10 cyfr (dostałem '${nipRaw}' = ${nip.length} po normalizacji)`);
  if (!address || address.length < 10) errors.push("--address=<str> wymagane (min 10 znaków)");
  if (!invoiceEmail || !isValidEmail(invoiceEmail)) errors.push("--invoice-email=<email> wymagane (poprawny format)");

  if (errors.length > 0) {
    console.error("[set-billing-company-data] FAIL:");
    for (const e of errors) console.error(`  - ${e}`);
    console.error("");
    console.error("Użycie:");
    console.error("  npx tsx scripts/set-billing-company-data.ts \\");
    console.error("    --tenant=<uuid_klienta> \\");
    console.error('    --legal-name="Restauracja Alfa Sp. z o.o." \\');
    console.error("    --nip=1234567890 \\");
    console.error('    --address="ul. Krakowska 12, 30-123 Kraków" \\');
    console.error("    --invoice-email=ksiegowosc@alfa.pl");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  // Sprawdź czy tenant istnieje
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId! },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!tenant) {
    console.error(`[set-billing-company-data] FAIL: tenant ${tenantId} nie istnieje w DB`);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (tenant.deletedAt) {
    console.error(`[set-billing-company-data] FAIL: tenant ${tenantId} (${tenant.name}) jest usunięty (deletedAt=${tenant.deletedAt.toISOString()})`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const valueJson = {
    legalName: legalName!,
    nip,
    address: address!,
    invoiceEmail: invoiceEmail!,
  };

  console.log(`[set-billing-company-data] Tenant: ${tenant.name} (${tenant.id})`);
  console.log(`[set-billing-company-data] Zapisuję billing_company_data:`);
  console.log(`  legalName:    ${valueJson.legalName}`);
  console.log(`  nip:          ${valueJson.nip}`);
  console.log(`  address:      ${valueJson.address}`);
  console.log(`  invoiceEmail: ${valueJson.invoiceEmail}`);

  await prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: BILLING_COMPANY_DATA_SETTING_KEY } },
    create: {
      tenantId: tenant.id,
      key: BILLING_COMPANY_DATA_SETTING_KEY,
      valueJson,
    },
    update: { valueJson },
  });

  console.log("");
  console.log("==================================================");
  console.log("[set-billing-company-data] OK — billing_company_data zapisane.");
  console.log("==================================================");
  console.log("");
  console.log("Następna płatność subskrypcji tego tenanta automatycznie wystawi FV VAT");
  console.log("w tenancie TT Grupa (BILLING_SELF_INVOICE_TENANT_ID).");
  console.log("");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("[set-billing-company-data] FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
