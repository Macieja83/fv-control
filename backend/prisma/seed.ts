import "dotenv/config";

import { Prisma } from "@prisma/client";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/lib/encryption.js";
import { jsonPayload } from "../src/lib/prisma-json.js";

const prisma = new PrismaClient();

async function main() {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY is required for seed (see .env.example)");
  }

  const tenant = await prisma.tenant.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    update: { name: "Resta Demo" },
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Resta Demo",
      nip: "1234567890",
    },
  });

  const adminHash = await argon2.hash("Admin123!", { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email: "admin@fvresta.local" },
    update: { passwordHash: adminHash, role: "OWNER", isActive: true, emailVerified: true },
    create: {
      id: "00000000-0000-4000-8000-000000000002",
      tenantId: tenant.id,
      email: "admin@fvresta.local",
      passwordHash: adminHash,
      role: "OWNER",
      isActive: true,
      emailVerified: true,
    },
  });

  /** Drugi użytkownik dev — typowy adres z frontowego .env (FV_RESTA_LOGIN_EMAIL). */
  const demoEmail = "kontakt@tuttopizza.pl";
  const demoHash = await argon2.hash("Admin123!", { type: argon2.argon2id });
  await prisma.user.upsert({
    where: { email: demoEmail },
    // update: omit tenantId so production kontakt stays on the real tenant (seed only refreshes password)
    update: { passwordHash: demoHash, role: "ADMIN", isActive: true, emailVerified: true },
    create: {
      id: "00000000-0000-4000-8000-000000000003",
      tenantId: tenant.id,
      email: demoEmail,
      passwordHash: demoHash,
      role: "ADMIN",
      isActive: true,
      emailVerified: true,
    },
  });

  const contractor = await prisma.contractor.upsert({
    where: {
      tenantId_nip: { tenantId: tenant.id, nip: "1111111111" },
    },
    update: { name: "Dostawca Demo Sp. z o.o." },
    create: {
      tenantId: tenant.id,
      name: "Dostawca Demo Sp. z o.o.",
      nip: "1111111111",
      address: "ul. Przykładowa 1, 00-001 Warszawa",
      email: "biuro@dostawca.example",
      phone: "+48123456789",
    },
  });

  const invId = "00000000-0000-4000-8000-000000000010";
  const existingInv = await prisma.invoice.findUnique({ where: { id: invId } });
  if (!existingInv) {
    const net1 = new Prisma.Decimal("100.00");
    const vat1 = new Prisma.Decimal("23.00");
    const gross1 = new Prisma.Decimal("123.00");
    const net2 = new Prisma.Decimal("50.00");
    const vat2 = new Prisma.Decimal("11.50");
    const gross2 = new Prisma.Decimal("61.50");
    const netTotal = net1.add(net2);
    const grossTotal = gross1.add(gross2);
    const vatTotal = grossTotal.sub(netTotal);

    await prisma.invoice.create({
      data: {
        id: invId,
        tenantId: tenant.id,
        contractorId: contractor.id,
        number: "FV/2026/SEED/001",
        issueDate: new Date("2026-03-15T00:00:00.000Z"),
        saleDate: new Date("2026-03-15T00:00:00.000Z"),
        dueDate: new Date("2026-03-29T00:00:00.000Z"),
        currency: "PLN",
        netTotal,
        vatTotal,
        grossTotal,
        status: "RECEIVED",
        source: "MANUAL",
        notes: "Faktura utworzona przez seed (środowisko developerskie).",
        createdById: user.id,
        items: {
          create: [
            {
              name: "Produkt A",
              quantity: new Prisma.Decimal("2.000"),
              unit: "szt",
              netPrice: new Prisma.Decimal("50.00"),
              vatRate: new Prisma.Decimal("23.00"),
              netValue: net1,
              grossValue: gross1,
            },
            {
              name: "Usługa B",
              quantity: new Prisma.Decimal("1.000"),
              unit: "h",
              netPrice: new Prisma.Decimal("50.00"),
              vatRate: new Prisma.Decimal("23.00"),
              netValue: net2,
              grossValue: gross2,
            },
          ],
        },
        events: {
          create: [
            {
              actorUserId: user.id,
              type: "CREATED",
              payload: jsonPayload({ number: "FV/2026/SEED/001", status: "RECEIVED" }),
            },
          ],
        },
      },
    });
  }

  const apiKeyEnc = encryptSecret("dev-pos-placeholder-key", encryptionKey);
  await prisma.integrationPos.upsert({
    where: { tenantId_provider: { tenantId: tenant.id, provider: "POS_RESTA" } },
    update: { baseUrl: "http://host.docker.internal:9999", apiKeyEncrypted: apiKeyEnc, isActive: false },
    create: {
      tenantId: tenant.id,
      provider: "POS_RESTA",
      baseUrl: "http://host.docker.internal:9999",
      apiKeyEncrypted: apiKeyEnc,
      isActive: false,
    },
  });

  // --- FVControl: permissions, roles (RBAC), mailboxes, ingestion registry ---
  const permKeys = [
    "invoices:read",
    "invoices:write",
    "contractors:read",
    "contractors:write",
    "integrations:manage",
    "admin:settings",
    "duplicates:resolve",
    "ingestion:trigger",
    "webhooks:manage",
  ];
  const permissions = await Promise.all(
    permKeys.map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key },
      }),
    ),
  );
  const permByKey = Object.fromEntries(permissions.map((p) => [p.key, p])) as Record<string, { id: string }>;

  async function grantPermissions(roleId: string, keys: string[]) {
    for (const key of keys) {
      const p = permByKey[key];
      if (!p) continue;
      const exists = await prisma.rolePermission.findFirst({
        where: { roleId, permissionId: p.id },
      });
      if (!exists) {
        await prisma.rolePermission.create({ data: { roleId, permissionId: p.id } });
      }
    }
  }

  async function ensureUserRoleLink(uid: string, roleId: string) {
    const exists = await prisma.userRoleLink.findFirst({ where: { userId: uid, roleId } });
    if (!exists) {
      await prisma.userRoleLink.create({ data: { userId: uid, roleId } });
    }
  }

  const roleOwner = await prisma.role.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: "OWNER" } },
    update: { name: "Owner" },
    create: { tenantId: tenant.id, slug: "OWNER", name: "Owner" },
  });
  const roleAdmin = await prisma.role.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: "ADMIN" } },
    update: { name: "Administrator" },
    create: { tenantId: tenant.id, slug: "ADMIN", name: "Administrator" },
  });
  const roleAccountant = await prisma.role.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: "ACCOUNTANT" } },
    update: { name: "Accountant" },
    create: { tenantId: tenant.id, slug: "ACCOUNTANT", name: "Accountant" },
  });
  const roleViewer = await prisma.role.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: "VIEWER" } },
    update: { name: "Viewer" },
    create: { tenantId: tenant.id, slug: "VIEWER", name: "Viewer" },
  });

  await grantPermissions(roleOwner.id, permKeys);
  await grantPermissions(roleAdmin.id, permKeys);
  await grantPermissions(roleAccountant.id, [
    "invoices:read",
    "invoices:write",
    "contractors:read",
    "contractors:write",
    "duplicates:resolve",
    "ingestion:trigger",
  ]);
  await grantPermissions(roleViewer.id, ["invoices:read", "contractors:read"]);

  const demoUser = await prisma.user.findUnique({ where: { email: demoEmail } });
  await ensureUserRoleLink(user.id, roleOwner.id);
  if (demoUser) {
    await ensureUserRoleLink(demoUser.id, roleAdmin.id);
  }

  const mbLabels = [
    { provider: "GMAIL" as const, label: "Gmail — billing #1" },
    { provider: "GMAIL" as const, label: "Gmail — billing #2" },
    { provider: "GMAIL" as const, label: "Gmail — billing #3" },
    { provider: "IMAP" as const, label: "Zenbox IMAP" },
  ];
  for (const m of mbLabels) {
    const existing = await prisma.mailbox.findFirst({
      where: { tenantId: tenant.id, label: m.label },
    });
    if (existing) continue;
    const mb = await prisma.mailbox.create({
      data: { tenantId: tenant.id, provider: m.provider, label: m.label },
    });
    await prisma.mailboxSyncState.create({
      data: { mailboxId: mb.id, historyId: null, uidValidity: null, uidNext: null },
    });
  }

  const srcDefs: Array<{ kind: "MAIL_GMAIL" | "MAIL_IMAP" | "KSEF" | "RESTA_API" | "MANUAL_UPLOAD"; label: string }> = [
    { kind: "MAIL_GMAIL", label: "gmail-aggregate" },
    { kind: "MAIL_IMAP", label: "zenbox" },
    { kind: "KSEF", label: "primary" },
    { kind: "RESTA_API", label: "pos-resta" },
    { kind: "MANUAL_UPLOAD", label: "ui-upload" },
  ];
  for (const s of srcDefs) {
    await prisma.ingestionSource.upsert({
      where: { tenantId_kind_label: { tenantId: tenant.id, kind: s.kind, label: s.label } },
      update: {},
      create: { tenantId: tenant.id, kind: s.kind, label: s.label },
    });
  }

  await prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "feature.ai_extraction_mock" } },
    update: { valueJson: { enabled: true } },
    create: { tenantId: tenant.id, key: "feature.ai_extraction_mock", valueJson: { enabled: true } },
  });

  // --- Compliance / KSeF filter demo rows (idempotent) ---
  const mkItem = (name: string, net: string, gross: string) => ({
    name,
    quantity: new Prisma.Decimal("1.000"),
    unit: "szt",
    netPrice: new Prisma.Decimal(net),
    vatRate: new Prisma.Decimal("23.00"),
    netValue: new Prisma.Decimal(net),
    grossValue: new Prisma.Decimal(gross),
  });

  async function ensureDemoInvoice(
    id: string,
    number: string,
    extra: Partial<{
      intakeSourceType: "EMAIL" | "UPLOAD" | "OCR_SCAN" | "KSEF_API" | "CASH_REGISTER";
      sourceAccount: string | null;
      documentKind: "INVOICE" | "RECEIPT_WITH_NIP" | "OTHER";
      legalChannel: "KSEF" | "OUTSIDE_KSEF" | "EXCLUDED" | "UNKNOWN";
      ksefRequired: boolean;
      ksefStatus: "NOT_APPLICABLE" | "TO_ISSUE" | "RECEIVED" | "MANUAL_REVIEW";
      reviewStatus: "PARSED" | "NEEDS_REVIEW" | "NEW";
      gross: string;
      net: string;
      vat: string;
    }>,
  ) {
    const exists = await prisma.invoice.findUnique({ where: { id } });
    if (exists) return;
    const net = new Prisma.Decimal(extra.net ?? "100.00");
    const vat = new Prisma.Decimal(extra.vat ?? "23.00");
    const gross = new Prisma.Decimal(extra.gross ?? "123.00");
    await prisma.invoice.create({
      data: {
        id,
        tenantId: tenant.id,
        contractorId: contractor.id,
        number,
        issueDate: new Date("2026-04-01T00:00:00.000Z"),
        currency: "PLN",
        netTotal: net,
        vatTotal: vat,
        grossTotal: gross,
        status: "RECEIVED",
        source: "MANUAL",
        notes: `Compliance demo: ${number}`,
        createdById: user.id,
        intakeSourceType: extra.intakeSourceType ?? "UPLOAD",
        sourceAccount: extra.sourceAccount ?? null,
        documentKind: extra.documentKind ?? "INVOICE",
        legalChannel: extra.legalChannel ?? "UNKNOWN",
        ksefRequired: extra.ksefRequired ?? false,
        ksefStatus: extra.ksefStatus ?? "NOT_APPLICABLE",
        reviewStatus: extra.reviewStatus ?? "PARSED",
        items: { create: [mkItem("Demo line", net.toString(), gross.toString())] },
      },
    });
    await prisma.invoiceSourceRecord.create({
      data: {
        tenantId: tenant.id,
        invoiceId: id,
        intakeSourceType: extra.intakeSourceType ?? "UPLOAD",
        sourceAccount: extra.sourceAccount ?? "seed",
        externalRef: `seed-${number}`,
        metadata: { demo: true } as object,
      },
    });
  }

  await ensureDemoInvoice("00000000-0000-4000-8000-000000000020", "DEMO-GMAIL-001", {
    intakeSourceType: "EMAIL",
    sourceAccount: "gmail-billing-1",
    documentKind: "INVOICE",
    legalChannel: "OUTSIDE_KSEF",
    ksefRequired: false,
    ksefStatus: "NOT_APPLICABLE",
    reviewStatus: "PARSED",
  });

  await ensureDemoInvoice("00000000-0000-4000-8000-000000000021", "DEMO-SCAN-001", {
    intakeSourceType: "OCR_SCAN",
    sourceAccount: "scanner-01",
    documentKind: "INVOICE",
    legalChannel: "OUTSIDE_KSEF",
    reviewStatus: "NEEDS_REVIEW",
    ksefStatus: "NOT_APPLICABLE",
  });

  await ensureDemoInvoice("00000000-0000-4000-8000-000000000022", "DEMO-KSEF-001", {
    intakeSourceType: "KSEF_API",
    sourceAccount: "ksef-primary",
    documentKind: "INVOICE",
    legalChannel: "KSEF",
    ksefRequired: false,
    ksefStatus: "RECEIVED",
    reviewStatus: "PARSED",
  });

  await ensureDemoInvoice("00000000-0000-4000-8000-000000000023", "DEMO-PARAGON-001", {
    intakeSourceType: "CASH_REGISTER",
    sourceAccount: "pos-1",
    documentKind: "RECEIPT_WITH_NIP",
    legalChannel: "OUTSIDE_KSEF",
    gross: "200.00",
    net: "162.60",
    vat: "37.40",
    ksefRequired: false,
    ksefStatus: "NOT_APPLICABLE",
    reviewStatus: "PARSED",
  });

  await ensureDemoInvoice("00000000-0000-4000-8000-000000000024", "DEMO-SPRZEDAZ-001", {
    intakeSourceType: "UPLOAD",
    sourceAccount: "sales-ui",
    documentKind: "INVOICE",
    legalChannel: "KSEF",
    ksefRequired: true,
    ksefStatus: "TO_ISSUE",
    reviewStatus: "PARSED",
  });

  console.log(
    "Seed OK: Resta Demo — admin@fvresta.local / Admin123!  oraz  kontakt@tuttopizza.pl / Admin123!",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
