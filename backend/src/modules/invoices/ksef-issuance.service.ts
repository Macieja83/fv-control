import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { loadKsefClientForTenant } from "../ksef/ksef-tenant-credentials.service.js";
import { buildFa3InvoiceXml, type Fa3LineInput } from "./ksef-fa3-xml.js";
import { serializeInvoiceDetail } from "./invoice-serialize.js";

async function applyKsefSubmitStub(prisma: PrismaClient, tenantId: string, invoiceId: string, payload: object) {
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { ksefStatus: "PENDING", ksefReferenceId: `stub-${invoiceId.slice(0, 8)}` },
    });
    await tx.invoiceComplianceEvent.create({
      data: {
        tenantId,
        invoiceId,
        eventType: "KSEF_SUBMIT_REQUESTED",
        payload,
      },
    });
  });
}

function firstKsefNumber(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const direct = o.ksefNumber ?? o.KsefNumber;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const inv = o.invoiceId;
  if (typeof inv === "string" && inv.trim()) return inv.trim();
  return null;
}

export async function submitInvoiceToKsef(prisma: PrismaClient, tenantId: string, invoiceId: string) {
  const cfg = loadConfig();
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      contractor: true,
      items: { orderBy: { id: "asc" } },
      tenant: true,
      files: true,
    },
  });
  if (!inv) throw AppError.notFound("Nie znaleziono faktury.");
  if (inv.ledgerKind !== "SALE") {
    throw AppError.validation("Wysyłka do KSeF dotyczy wyłącznie faktur sprzedaży (zakładka Sprzedaż).");
  }
  if (!inv.ksefRequired) {
    throw AppError.validation("Dla tej faktury nie wymaga się KSeF (rodzaj dokumentu / kanał prawny).");
  }
  if (inv.legalChannel !== "KSEF") {
    throw AppError.validation("Kanał prawny inny niż KSeF — sprawdź klasyfikację dokumentu.");
  }

  const client = await loadKsefClientForTenant(prisma, tenantId);
  const useLive = cfg.KSEF_ISSUANCE_MODE === "live" && client !== null;

  if (!useLive) {
    await applyKsefSubmitStub(prisma, tenantId, invoiceId, {
      stub: true,
      reason: cfg.KSEF_ISSUANCE_MODE !== "live" ? "KSEF_ISSUANCE_MODE!=live" : "missing KSEF credentials",
    });
    const full = await prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { contractor: true, items: { orderBy: { id: "asc" } }, files: true },
    });
    if (!full) throw AppError.notFound("Nie znaleziono faktury.");
    return serializeInvoiceDetail(full);
  }

  const sellerNip = (inv.tenant.nip ?? cfg.KSEF_NIP ?? "").replace(/\D/g, "");
  if (sellerNip.length !== 10) {
    throw AppError.validation("Uzupełnij NIP firmy (Ustawienia tenant / KSEF_NIP) — wymagany do wystawienia FA.");
  }
  const buyerNip = (inv.contractor?.nip ?? "").replace(/\D/g, "");
  if (buyerNip.length !== 10) {
    throw AppError.validation("Kontrahent musi mieć poprawny 10-cyfrowy NIP (nabywca).");
  }

  const lines: Fa3LineInput[] = inv.items.map((it) => ({
    name: it.name,
    quantity: it.quantity.toString(),
    unit: it.unit,
    netPrice: it.netPrice.toString(),
    vatRate: it.vatRate.toString(),
    netValue: it.netValue.toString(),
    grossValue: it.grossValue.toString(),
  }));
  if (lines.length === 0) {
    throw AppError.validation("Faktura sprzedaży musi mieć co najmniej jedną pozycję przed wysyłką do KSeF.");
  }

  const issueYmd = inv.issueDate.toISOString().slice(0, 10);
  const xml = buildFa3InvoiceXml({
    sellerName: inv.tenant.name,
    sellerNip,
    buyerName: inv.contractor!.name,
    buyerNip,
    invoiceNumber: inv.number,
    issueDateYmd: issueYmd,
    currency: inv.currency,
    lines,
    netTotal: inv.netTotal.toString(),
    vatTotal: inv.vatTotal.toString(),
    grossTotal: inv.grossTotal.toString(),
  });
  await client!.authenticate();
  const encrypted = await client!.prepareOnlineInvoiceEncryption(xml);

  const sessionBody = {
    formCode: {
      systemCode: "FA (3)",
      schemaVersion: "1-0E",
      value: "FA",
    },
    encryption: encrypted.sessionEncryption,
  };
  const sessionJson = (await client!.openOnlineSessionForm(sessionBody)) as Record<string, unknown>;
  const sessionRef =
    (typeof sessionJson.referenceNumber === "string" && sessionJson.referenceNumber) ||
    (typeof sessionJson.sessionReferenceNumber === "string" && sessionJson.sessionReferenceNumber) ||
    (typeof sessionJson.reference === "string" && sessionJson.reference) ||
    null;
  if (!sessionRef) {
    throw AppError.validation(
      `KSeF: nie rozpoznano numeru sesji w odpowiedzi: ${JSON.stringify(sessionJson).slice(0, 400)}`,
    );
  }

  let sendJson: unknown;
  try {
    sendJson = await client!.postOnlineInvoice(sessionRef, encrypted.invoicePayload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await client!.closeOnlineSession(sessionRef);
    } catch {
      /* ignore */
    }
    throw AppError.validation(`KSeF: wysyłka nie powiodła się (${msg})`);
  }

  const ksefNo = firstKsefNumber(sendJson);
  try {
    await client!.closeOnlineSession(sessionRef);
  } catch {
    /* ignore close errors */
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        ksefStatus: ksefNo ? "SENT" : "PENDING",
        ...(ksefNo ? { ksefNumber: ksefNo } : {}),
        ksefReferenceId: sessionRef.slice(0, 120),
        rawPayload: { ...(inv.rawPayload as object | null), ksefLastSendResponse: sendJson } as object,
      },
    });
    await tx.invoiceComplianceEvent.create({
      data: {
        tenantId,
        invoiceId,
        eventType: "KSEF_SUBMIT_REQUESTED",
        payload: { live: true, sessionRef, ksefNumber: ksefNo, invoiceHash: encrypted.invoicePayload.invoiceHash } as object,
      },
    });
  });

  const full = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { contractor: true, items: { orderBy: { id: "asc" } }, files: true },
  });
  if (!full) throw AppError.notFound("Nie znaleziono faktury.");
  return serializeInvoiceDetail(full);
}
