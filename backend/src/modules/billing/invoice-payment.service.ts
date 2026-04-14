import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { createInvoiceEvent } from "../invoices/invoice-events.js";

type InvoiceCheckoutPaymentMethod = "CARD" | "BLIK" | "GOOGLE_PAY" | "APPLE_PAY";

function toMinorUnits(amount: string): number {
  const n = Number.parseFloat(amount);
  if (!Number.isFinite(n) || n <= 0) {
    throw AppError.validation("Invoice amount must be greater than 0");
  }
  return Math.round(n * 100);
}

export async function createInvoicePaymentCheckoutSession(
  prisma: PrismaClient,
  tenantId: string,
  invoiceId: string,
  actorUserId: string | null,
  input: {
    successUrl: string;
    cancelUrl: string;
    paymentMethod?: InvoiceCheckoutPaymentMethod;
  },
) {
  const cfg = loadConfig();
  if (!cfg.STRIPE_SECRET_KEY) throw AppError.unavailable("Missing STRIPE_SECRET_KEY");

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: {
      id: true,
      number: true,
      currency: true,
      grossTotal: true,
      status: true,
    },
  });
  if (!invoice) throw AppError.notFound("Invoice not found");
  if (invoice.status === "PAID") throw AppError.validation("Invoice is already paid");

  const unitAmount = toMinorUnits(invoice.grossTotal.toString());
  const currency = invoice.currency.toLowerCase();

  // Stripe: BLIK jest tylko dla PLN — inaczej brak poprawnego flow (kod / push z banku).
  if (input.paymentMethod === "BLIK" && currency !== "pln") {
    throw AppError.validation(
      "BLIK w Stripe działa wyłącznie dla faktur w PLN. Użyj karty / portfela albo zmień walutę faktury.",
    );
  }

  const params = new URLSearchParams({
    mode: "payment",
    locale: "pl",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": currency,
    "line_items[0][price_data][unit_amount]": String(unitAmount),
    "line_items[0][price_data][product_data][name]": `Faktura ${invoice.number}`,
    "metadata[tenantId]": tenantId,
    "metadata[invoiceId]": invoice.id,
    "metadata[billingFlow]": "invoice_payment",
    "client_reference_id": invoice.id,
    "payment_intent_data[description]": `FV ${invoice.number}`.slice(0, 120),
  });

  if (input.paymentMethod === "BLIK") {
    params.append("payment_method_types[]", "blik");
  } else {
    params.append("payment_method_types[]", "card");
  }

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const body = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !body.id || !body.url) {
    throw AppError.unavailable(body.error?.message ?? "Stripe invoice checkout session failed");
  }

  await createInvoiceEvent(prisma, {
    invoiceId: invoice.id,
    actorUserId,
    type: "UPDATED",
    payload: {
      payment: {
        kind: "checkout_created",
        provider: "STRIPE",
        method: input.paymentMethod ?? "CARD",
        sessionId: body.id,
      },
    },
  });

  return { checkoutUrl: body.url, sessionId: body.id };
}
