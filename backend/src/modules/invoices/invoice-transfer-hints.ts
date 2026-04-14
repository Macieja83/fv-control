import type { Prisma } from "@prisma/client";
import { extractVendorNameFromNormalizedPayload } from "./invoice-vendor-nip.js";

type ListRowContractor = { name: string | null; nip: string | null } | null;

/**
 * Pola do przelewu na konto wystawcy (z OCR / KSeF / ręcznej edycji payloadu).
 * Płatność online przez Stripe dla faktur została usunięta — użytkownik robi przelew w banku lub (później) PISP.
 */
export function buildInvoiceTransferHints(
  normalizedPayload: unknown,
  inv: {
    number: string;
    grossTotal: Prisma.Decimal;
    currency: string;
    contractor: ListRowContractor;
  },
): {
  transferRecipient: string | null;
  transferBankAccount: string | null;
  transferBankName: string | null;
  transferTitle: string | null;
  transferAmount: string;
  transferCurrency: string;
} {
  const o = normalizedPayload && typeof normalizedPayload === "object" ? (normalizedPayload as Record<string, unknown>) : {};
  const bankRaw = typeof o.bankAccount === "string" ? o.bankAccount.replace(/\s/g, "").trim() : "";
  const bankNameRaw = typeof o.bankName === "string" ? o.bankName.trim() : "";
  const titleRaw = typeof o.paymentDescription === "string" ? o.paymentDescription.trim() : "";
  const fromPayloadName = extractVendorNameFromNormalizedPayload(normalizedPayload);
  const recipient =
    inv.contractor?.name?.trim() ||
    fromPayloadName ||
    (typeof o.contractorName === "string" ? o.contractorName.trim() : null) ||
    null;

  return {
    transferRecipient: recipient,
    transferBankAccount: bankRaw.length > 0 ? bankRaw : null,
    transferBankName: bankNameRaw.length > 0 ? bankNameRaw : null,
    transferTitle: titleRaw.length > 0 ? titleRaw : inv.number,
    transferAmount: inv.grossTotal.toString(),
    transferCurrency: inv.currency,
  };
}
