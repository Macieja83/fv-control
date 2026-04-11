import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { refreshInvoiceCompliance } from "../compliance/compliance.service.js";
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

  const fromBody = input.nip?.replace(/\D/g, "") ?? "";
  const fromPayload = extractVendorNipFromNormalizedPayload(inv.normalizedPayload)?.replace(/\D/g, "") ?? "";
  const nipDigits = (fromBody.length >= 10 ? fromBody : fromPayload).slice(0, 14);
  if (nipDigits.length !== 10) {
    throw AppError.validation("Podaj prawidłowy NIP kontrahenta (10 cyfr) albo uzupełnij dane ekstrakcji na fakturze.");
  }

  const nameGuess =
    input.name?.trim() ||
    extractVendorNameFromNormalizedPayload(inv.normalizedPayload) ||
    `Kontrahent ${nipDigits}`;

  let created = false;
  let contractor = await prisma.contractor.findFirst({
    where: { tenantId, nip: nipDigits, deletedAt: null },
  });
  if (!contractor) {
    contractor = await prisma.contractor.create({
      data: { tenantId, nip: nipDigits, name: nameGuess.slice(0, 300) },
    });
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
