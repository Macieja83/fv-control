import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { buildInvoiceTransferHints } from "../invoices/invoice-transfer-hints.js";

/**
 * Status inicjacji PISP dla faktury. Pełna integracja (redirect do banku + webhook) zależy od wybranego agregatora.
 * Do tego czasu: QR EPC + przelew ręczny w UI.
 */
export async function getInvoicePispPaymentState(prisma: PrismaClient, tenantId: string, invoiceId: string) {
  const cfg = loadConfig();
  const configured = Boolean(cfg.PISP_PROVIDER_BASE_URL?.trim() && cfg.PISP_API_KEY?.trim());

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: {
      id: true,
      number: true,
      currency: true,
      grossTotal: true,
      status: true,
      normalizedPayload: true,
      contractor: { select: { name: true, nip: true } },
    },
  });
  if (!invoice) throw AppError.notFound("Invoice not found");
  if (invoice.status === "PAID") {
    return {
      enabled: false,
      reason: "already_paid" as const,
      message: "Faktura jest już oznaczona jako opłacona.",
      transfer: null,
    };
  }

  const transfer = buildInvoiceTransferHints(invoice.normalizedPayload, {
    number: invoice.number,
    grossTotal: invoice.grossTotal,
    currency: invoice.currency,
    contractor: invoice.contractor ? { name: invoice.contractor.name, nip: invoice.contractor.nip } : null,
  });

  if (!configured) {
    return {
      enabled: false,
      reason: "not_configured" as const,
      message:
        "PISP nie jest skonfigurowany. Ustaw PISP_PROVIDER_BASE_URL i PISP_API_KEY w backend/.env po podpisaniu umowy z dostawcą open banking. Do tego czasu użyj kodu QR (EPC) lub przelewu ręcznego.",
      transfer,
    };
  }

  return {
    enabled: false,
    reason: "integration_pending" as const,
    message:
      "Zmienne PISP są ustawione, ale wywołanie API dostawcy nie jest jeszcze zaimplementowane w tej wersji — dopnij moduł zgodnie z dokumentacją wybranego TPP.",
    transfer,
  };
}
