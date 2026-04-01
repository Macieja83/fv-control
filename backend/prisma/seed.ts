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

  const passwordHash = await argon2.hash("Admin123!", { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email: "admin@fvresta.local" },
    update: { passwordHash, role: "OWNER", isActive: true },
    create: {
      id: "00000000-0000-4000-8000-000000000002",
      tenantId: tenant.id,
      email: "admin@fvresta.local",
      passwordHash,
      role: "OWNER",
      isActive: true,
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

  console.log("Seed OK: tenant Resta Demo, admin@fvresta.local / Admin123!");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
