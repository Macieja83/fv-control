import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { refreshInvoiceCompliance } from "../compliance/compliance.service.js";
import { findContractorByNormalizedNip, polishNipDigits10 } from "../contractors/contractor-resolve.js";
import {
  extractVendorNameFromNormalizedPayload,
  extractVendorNipFromNormalizedPayload,
} from "./invoice-vendor-nip.js";

export type InvoiceAdoptVendorInput = {
  nip?: string | undefined;
  name?: string | undefined;
};

/**
 * Tworzy lub dopina istniejącego kontrahenta po NIP i przypisuje do faktury kosztowej
 * (gdy `contractorId` było null — „nowy kontrahent”).
 */
export async function adoptInvoiceVendor(
  prisma: PrismaClient,
  tenantId: string,
  invoiceId: string,
  input: InvoiceAdoptVendorInput,
): Promise<{ contractorId: string; created: boolean }> {
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: {
      id: true,
      contractorId: true,
      ledgerKind: true,
      status: true,
      normalizedPayload: true,
    },
  });
  if (!inv) throw AppError.notFound("Nie znaleziono faktury.");
  if (inv.status === "INGESTING") {
    throw AppError.validation("Poczekaj na zakończenie przetwarzania faktury, zanim przypiszesz kontrahenta.");
  }
  if (inv.ledgerKind === "SALE") {
    throw AppError.validation("Przypisanie kontrahenta dotyczy tylko faktur kosztowych (zakup).");
  }
  if (inv.contractorId) {
    throw AppError.validation("Ta faktura ma już przypisanego kontrahenta.");
  }

  const fromBody = polishNipDigits10(input.nip ?? "");
  const fromPayload = polishNipDigits10(extractVendorNipFromNormalizedPayload(inv.normalizedPayload));
  const nip10 = fromBody ?? fromPayload;
  if (!nip10) {
    throw AppError.validation("Podaj prawidłowy NIP kontrahenta (10 cyfr) albo uzupełnij dane ekstrakcji na fakturze.");
  }

  const nameGuess =
    input.name?.trim() ||
    extractVendorNameFromNormalizedPayload(inv.normalizedPayload) ||
    `Kontrahent ${nip10}`;

  let created = false;
  let contractor = await findContractorByNormalizedNip(prisma, tenantId, nip10);
  if (!contractor) {
    const row = await prisma.contractor.create({
      data: { tenantId, nip: nip10, name: nameGuess.slice(0, 300) },
    });
    contractor = { id: row.id };
    created = true;
  }

  await prisma.invoice.update({
    where: { id: inv.id },
    data: { contractorId: contractor.id },
  });

  await refreshInvoiceCompliance(
    prisma,
    tenantId,
    inv.id,
    {},
    { eventType: "COMPLIANCE_VALIDATED", enqueueDuplicate: false, enqueueIngested: false },
  );

  return { contractorId: contractor.id, created };
}
