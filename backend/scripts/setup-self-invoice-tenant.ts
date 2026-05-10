/**
 * B15 dogfood — setup tenant wystawcy własnych FV za subskrypcje fv.resta.biz.
 *
 * Tworzy (lub aktualizuje) tenant "Tutto Grupa Marcin Maciejewski" w bazie FV control
 * z NIP 8393028257 + user OWNER do logowania. Wypisuje UUID tenanta do dopisania do
 * `BILLING_SELF_INVOICE_TENANT_ID` w `.env` na VPS.
 *
 * Idempotentny: jeśli tenant z danym NIP już istnieje, tylko wypisuje jego UUID.
 *
 * Użycie (default = TT Grupa Marcin Maciejewski):
 *   npx tsx scripts/setup-self-invoice-tenant.ts
 *
 * Z customowymi danymi:
 *   SELF_TENANT_NAME="Inna Firma Sp. z o.o." \
 *   SELF_TENANT_NIP="1234567890" \
 *   SELF_TENANT_OWNER_EMAIL="owner@firma.pl" \
 *   SELF_TENANT_OWNER_PASSWORD="Strong!Pass123" \
 *   npx tsx scripts/setup-self-invoice-tenant.ts
 *
 * Po utworzeniu:
 *   1. Skopiuj UUID z outputu i dopisz do .env: BILLING_SELF_INVOICE_TENANT_ID=<uuid>
 *   2. Zaloguj się do UI jako owner@... i wgraj KSeF token TT Grupa
 *      (Ustawienia → KSeF → token PKCS#5 + password)
 *   3. Restart worker: systemctl --user restart fv-control-worker
 */

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password.js";

function genTempPassword(): string {
  // Strong-enough temp password (24 chars, mixed case + digits + special).
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const specials = "!@#$%&*";
  let out = "";
  for (let i = 0; i < 22; i++) out += chars[Math.floor(Math.random() * chars.length)];
  out += specials[Math.floor(Math.random() * specials.length)];
  out += String(Math.floor(Math.random() * 10));
  return out;
}

async function main() {
  const prisma = new PrismaClient();

  const name = (process.env.SELF_TENANT_NAME ?? "Tutto Grupa Marcin Maciejewski").trim();
  const nip = (process.env.SELF_TENANT_NIP ?? "8393028257").replace(/\D/g, "");
  const ownerEmail = (process.env.SELF_TENANT_OWNER_EMAIL ?? "marcin@tutto-grupa.local").trim().toLowerCase();
  const providedPassword = process.env.SELF_TENANT_OWNER_PASSWORD?.trim();

  if (nip.length !== 10) {
    console.error(`[setup-self-invoice-tenant] FAIL: NIP musi mieć dokładnie 10 cyfr (dostałem '${nip}', ${nip.length} znaków).`);
    process.exit(1);
  }

  console.log("[setup-self-invoice-tenant] Sprawdzam czy tenant z tym NIP już istnieje...");
  const existing = await prisma.tenant.findUnique({
    where: { nip },
    select: { id: true, name: true, deletedAt: true },
  });

  if (existing && !existing.deletedAt) {
    console.log("");
    console.log("==================================================");
    console.log(`[setup-self-invoice-tenant] Tenant z NIP ${nip} JUŻ ISTNIEJE.`);
    console.log(`  UUID:        ${existing.id}`);
    console.log(`  Nazwa:       ${existing.name}`);
    console.log("==================================================");
    console.log("");
    console.log("Dopisz do .env na VPS:");
    console.log(`  BILLING_SELF_INVOICE_TENANT_ID=${existing.id}`);
    console.log("");
    console.log("Jeśli chcesz nadpisać nazwę / dodać nowego ownera — zrób to ręcznie w UI.");
    await prisma.$disconnect();
    process.exit(0);
  }

  const password = providedPassword ?? genTempPassword();
  const passwordHash = await hashPassword(password);

  console.log(`[setup-self-invoice-tenant] Tworzę tenant '${name}' (NIP ${nip}) + user OWNER ${ownerEmail}...`);
  const tenant = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.create({
      data: { name, nip },
      select: { id: true },
    });
    await tx.user.create({
      data: {
        tenantId: t.id,
        email: ownerEmail,
        passwordHash,
        emailVerified: true,
        role: "OWNER",
        isActive: true,
      },
    });
    return t;
  });

  console.log("");
  console.log("==================================================");
  console.log("[setup-self-invoice-tenant] SUCCESS");
  console.log(`  Tenant UUID:    ${tenant.id}`);
  console.log(`  Tenant nazwa:   ${name}`);
  console.log(`  Tenant NIP:     ${nip}`);
  console.log(`  Owner email:    ${ownerEmail}`);
  if (!providedPassword) {
    console.log(`  Owner password: ${password}  <-- ZAPISZ ! (random)`);
  } else {
    console.log(`  Owner password: (z env SELF_TENANT_OWNER_PASSWORD)`);
  }
  console.log("==================================================");
  console.log("");
  console.log("NEXT STEPS:");
  console.log("");
  console.log("1. Dopisz do .env na VPS:");
  console.log(`     BILLING_SELF_INVOICE_TENANT_ID=${tenant.id}`);
  console.log("");
  console.log(`2. Zaloguj się do UI jako ${ownerEmail}, Ustawienia → KSeF → wgraj token PKCS#5 + password.`);
  console.log("");
  console.log("3. Restart worker żeby załadował nowe env:");
  console.log("     systemctl --user restart fv-control-worker");
  console.log("");
  console.log("4. Test: kupić własną subskrypcję BLIKiem z innego konta klienckiego (musi mieć");
  console.log("   ustawione TenantSetting[billing_company_data] przez `npm run setup:billing-data`).");
  console.log("");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("[setup-self-invoice-tenant] FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
