/**
 * Dogfood: wystawianie FV VAT za subskrypcje fv.resta.biz przez sam fv.resta.biz.
 *
 * Decyzja 2026-05-10 (research/sales-ready-vat-invoice.md):
 * - Wystawca: TT Grupa Marcin Maciejewski (NIP 8393028257) — własny tenant w bazie FV control
 *   (`BILLING_SELF_INVOICE_TENANT_ID` w `.env`)
 * - Cena: 67 zł brutto = 54.47 netto + 12.53 VAT 23% (PRO_PLAN_*_PLN constants)
 * - Idempotency: Stripe `eventId` → `Invoice.sourceExternalId` + unique `(tenantId, ingestionKind, sourceExternalId)`
 * - Numeracja: wspólna seria TT Grupa (`FA/YYYY-MM/NNN`), generator policzy ostatni w miesiącu
 * - Submit do KSeF: po `submitInvoiceToKsef` (stub gdy `KSEF_ISSUANCE_MODE=stub`, live gdy `=live`)
 * - Email klientowi: PDF + UPO przez Resend (B7) — gdy SMTP nie skonfigurowany, log + zapis "EMAIL_PENDING"
 *
 * Trigger: webhook Stripe `checkout.session.completed` lub `invoice.paid` →
 * `billing-webhook.service.ts` → `createSelfInvoiceForSubscriptionPayment` → `submitInvoiceToKsef`.
 */

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { loadConfig } from "../../config.js";
import {
  PRO_PLAN_PRICE_PLN,
  PRO_PLAN_NET_PLN,
  PRO_PLAN_VAT_PLN,
  PRO_PLAN_VAT_RATE,
  PRO_PREPAID_PERIOD_DAYS,
} from "./billing-constants.js";

const BILLING_COMPANY_DATA_SETTING_KEY = "billing_company_data";

/** Dane firmy klienta jako kontrahent w fakturze TT Grupa. */
export type BillingCompanyData = {
  /** Pełna nazwa firmowa (np. „Restauracja Alfa Sp. z o.o."). */
  legalName: string;
  /** NIP 10 cyfr. */
  nip: string;
  /** Adres do faktury (jedna linia lub multiline). */
  address: string;
  /** Email do wysyłki FV PDF (może być inny niż user.email właściciela tenanta). */
  invoiceEmail: string;
};

function parseBillingCompanyData(raw: unknown): BillingCompanyData | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const legalName = typeof d.legalName === "string" ? d.legalName.trim() : "";
  const nip = typeof d.nip === "string" ? d.nip.replace(/\D/g, "") : "";
  const address = typeof d.address === "string" ? d.address.trim() : "";
  const invoiceEmail = typeof d.invoiceEmail === "string" ? d.invoiceEmail.trim() : "";
  if (!legalName || nip.length !== 10 || !address || !invoiceEmail) return null;
  return { legalName, nip, address, invoiceEmail };
}

/** Wczytaj dane firmy klienta z `TenantSetting[billing_company_data]`. */
export async function getBillingCompanyData(
  prisma: PrismaClient,
  customerTenantId: string,
): Promise<BillingCompanyData | null> {
  const row = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId: customerTenantId, key: BILLING_COMPANY_DATA_SETTING_KEY } },
    select: { valueJson: true },
  });
  if (!row) return null;
  return parseBillingCompanyData(row.valueJson);
}

/**
 * Zapisz dane firmy klienta (upsert TenantSetting[billing_company_data]).
 * Walidacja: NIP musi mieć 10 cyfr, legalName min 3, address min 10, invoiceEmail format.
 * Caller (route) wywołuje audit log osobno.
 */
export async function upsertBillingCompanyData(
  prisma: PrismaClient,
  customerTenantId: string,
  input: BillingCompanyData,
  actorUserId: string | null,
): Promise<BillingCompanyData> {
  // Normalizacja + walidacja (Zod schema w route powinna to już złapać, tu defensywnie)
  const normalized: BillingCompanyData = {
    legalName: input.legalName.trim(),
    nip: input.nip.replace(/\D/g, ""),
    address: input.address.trim(),
    invoiceEmail: input.invoiceEmail.trim().toLowerCase(),
  };
  if (normalized.legalName.length < 3) throw new Error("legalName min 3 znaki");
  if (normalized.nip.length !== 10) throw new Error("nip musi mieć 10 cyfr");
  if (normalized.address.length < 10) throw new Error("address min 10 znaków");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.invoiceEmail)) {
    throw new Error("invoiceEmail nie pasuje do formatu email");
  }

  await prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId: customerTenantId, key: BILLING_COMPANY_DATA_SETTING_KEY } },
    create: {
      tenantId: customerTenantId,
      key: BILLING_COMPANY_DATA_SETTING_KEY,
      valueJson: normalized as object,
      updatedById: actorUserId,
    },
    update: {
      valueJson: normalized as object,
      updatedById: actorUserId,
    },
  });

  return normalized;
}

/**
 * Generuje następny numer faktury w serii TT Grupa: `FA/YYYY-MM/NNN`.
 * NNN to liczba faktur SALE w tym tenancie w danym miesiącu issueDate + 1, padded do 3 cyfr.
 * Race condition: unique `(tenantId, number)` wyłapie kolizję — caller retry.
 */
export async function nextSelfInvoiceNumber(
  prisma: PrismaClient,
  selfTenantId: string,
  issueDate: Date,
): Promise<string> {
  const yyyy = issueDate.getUTCFullYear();
  const mm = String(issueDate.getUTCMonth() + 1).padStart(2, "0");
  const monthStart = new Date(Date.UTC(yyyy, issueDate.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(yyyy, issueDate.getUTCMonth() + 1, 1));

  const count = await prisma.invoice.count({
    where: {
      tenantId: selfTenantId,
      ledgerKind: "SALE",
      issueDate: { gte: monthStart, lt: monthEnd },
    },
  });

  const nnn = String(count + 1).padStart(3, "0");
  return `FA/${yyyy}-${mm}/${nnn}`;
}

export type SelfInvoicePayload = {
  /** Tenant klienta subskrybującego (kontrahent FV). */
  customerTenantId: string;
  /** Idempotency key: Stripe `event.id` dla prepaid checkout, Stripe `invoice.id` dla recurring billing. */
  stripeEventId: string;
  /** Metoda płatności użyta przez klienta. */
  paymentMethod: "card" | "blik" | "p24";
  /** Kwota brutto faktycznie wpłacona (PLN, zwykle PRO_PLAN_PRICE_PLN). */
  amountPaidPln: number;
  /** Moment płatności / wystawienia FV. */
  paidAt: Date;
  /** Okres rozliczeniowy subskrypcji — od. */
  periodStart: Date;
  /** Okres rozliczeniowy subskrypcji — do. */
  periodEnd: Date;
};

export type SelfInvoiceResult = {
  invoiceId: string;
  invoiceNumber: string;
  /** `true` jeśli ten Stripe event był już wcześniej zafakturowany (idempotent path). */
  duplicated: boolean;
};

/**
 * Główny entry point: po udanej płatności Stripe wystaw FV VAT w tenancie TT Grupa.
 *
 * Idempotency: jeśli `Invoice.sourceExternalId === stripeEventId` już istnieje w tenancie
 * self-invoice, zwracamy bez tworzenia duplikatu.
 *
 * Walidacje:
 * - `BILLING_SELF_INVOICE_TENANT_ID` w config
 * - tenant klienta ma kompletny `billing_company_data` w `TenantSetting`
 * - tenant TT Grupa ma `nip` (10 cyfr)
 *
 * Po utworzeniu Invoice caller wywołuje `submitInvoiceToKsef(prisma, selfTenantId, invoiceId)`.
 */
export async function createSelfInvoiceForSubscriptionPayment(
  prisma: PrismaClient,
  payload: SelfInvoicePayload,
): Promise<SelfInvoiceResult> {
  const cfg = loadConfig();
  const selfTenantId = cfg.BILLING_SELF_INVOICE_TENANT_ID;
  if (!selfTenantId) {
    throw AppError.unavailable(
      "BILLING_SELF_INVOICE_TENANT_ID nie skonfigurowane — dogfood FV za SaaS wyłączony. Ustaw env zmienną na UUID tenanta TT Grupa.",
    );
  }

  // Idempotency: ta płatność Stripe już zafakturowana?
  // Używamy `RESTA_API` jako IngestionSourceType (best-fit semantycznie: faktura przyszła przez Resta API webhook).
  // Unique constraint `(tenantId, ingestionKind, sourceExternalId)` zapewnia idempotency na poziomie DB.
  const existing = await prisma.invoice.findFirst({
    where: {
      tenantId: selfTenantId,
      ingestionKind: "RESTA_API",
      sourceExternalId: payload.stripeEventId,
    },
    select: { id: true, number: true },
  });
  if (existing) {
    return { invoiceId: existing.id, invoiceNumber: existing.number, duplicated: true };
  }

  // Walidacje: wystawca + klient
  const selfTenant = await prisma.tenant.findUnique({
    where: { id: selfTenantId },
    select: { id: true, name: true, nip: true },
  });
  if (!selfTenant) {
    throw AppError.unavailable(`Tenant self-invoice (${selfTenantId}) nie istnieje w DB`);
  }
  const sellerNip = (selfTenant.nip ?? "").replace(/\D/g, "");
  if (sellerNip.length !== 10) {
    throw AppError.unavailable(
      `Tenant self-invoice ${selfTenantId} (${selfTenant.name}) nie ma poprawnego NIP 10-cyfrowego`,
    );
  }

  const billing = await getBillingCompanyData(prisma, payload.customerTenantId);
  if (!billing) {
    throw AppError.validation(
      `Klient (tenant ${payload.customerTenantId}) nie ma kompletu danych firmowych (TenantSetting[${BILLING_COMPANY_DATA_SETTING_KEY}]). Wymagane: legalName, nip (10 cyfr), address, invoiceEmail.`,
    );
  }

  // Pobierz systemowego usera (actor) z tenanta self-invoice — pierwszy OWNER/ADMIN.
  const actor = await prisma.user.findFirst({
    where: { tenantId: selfTenantId, role: { in: ["OWNER", "ADMIN"] }, isActive: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!actor) {
    throw AppError.unavailable(
      `Tenant self-invoice ${selfTenantId} nie ma aktywnego OWNER/ADMIN user — nie da się ustawić createdBy na Invoice`,
    );
  }

  // Upsert Contractor (klient w bazie TT Grupa)
  const contractor = await prisma.contractor.upsert({
    where: { tenantId_nip: { tenantId: selfTenantId, nip: billing.nip } },
    create: {
      tenantId: selfTenantId,
      nip: billing.nip,
      name: billing.legalName,
      address: billing.address,
      email: billing.invoiceEmail,
    },
    update: {
      name: billing.legalName,
      address: billing.address,
      email: billing.invoiceEmail,
    },
  });

  // Generuj numer FV i utwórz Invoice
  const invoiceNumber = await nextSelfInvoiceNumber(prisma, selfTenantId, payload.paidAt);
  const periodLabel = formatPolishPeriod(payload.periodStart, payload.periodEnd);

  const created = await prisma.invoice.create({
    data: {
      tenantId: selfTenantId,
      contractorId: contractor.id,
      number: invoiceNumber,
      issueDate: payload.paidAt,
      saleDate: payload.paidAt,
      currency: "PLN",
      netTotal: new Prisma.Decimal(PRO_PLAN_NET_PLN.toFixed(2)),
      vatTotal: new Prisma.Decimal(PRO_PLAN_VAT_PLN.toFixed(2)),
      grossTotal: new Prisma.Decimal(payload.amountPaidPln.toFixed(2)),
      status: "PAID", // subskrypcja już opłacona przez Stripe → FV od razu w stanie PAID
      source: "MANUAL",
      ingestionKind: "RESTA_API", // webhook Stripe → nasz API endpoint → Invoice (semantycznie zgodne)
      sourceExternalId: payload.stripeEventId, // idempotency key: event id albo invoice id
      createdById: actor.id,
      ledgerKind: "SALE",
      intakeSourceType: "UPLOAD", // brak enum value dla "webhook/API" — UPLOAD najbliższe (system upload)
      documentKind: "INVOICE",
      legalChannel: "KSEF",
      ksefRequired: true,
      ksefStatus: "NOT_APPLICABLE", // submitInvoiceToKsef przestawi na PENDING/SUBMITTED
      reviewStatus: "NEW",
      accountingStatus: "NOT_EXPORTED",
      items: {
        create: [
          {
            name: `FV Control PRO — subskrypcja ${periodLabel} (${PRO_PREPAID_PERIOD_DAYS} dni, ${labelPaymentMethod(payload.paymentMethod)})`,
            quantity: new Prisma.Decimal(1),
            unit: "szt.",
            netPrice: new Prisma.Decimal(PRO_PLAN_NET_PLN.toFixed(2)),
            vatRate: new Prisma.Decimal(PRO_PLAN_VAT_RATE.toFixed(2)),
            netValue: new Prisma.Decimal(PRO_PLAN_NET_PLN.toFixed(2)),
            grossValue: new Prisma.Decimal(payload.amountPaidPln.toFixed(2)),
          },
        ],
      },
    },
    select: { id: true, number: true },
  });

  // Audit trail: zapis w InvoiceComplianceEvent — KSEF_SUBMIT_REQUESTED powstaje w submitInvoiceToKsef,
  // tu jedynie odnotuj że self-invoice powstała.
  await prisma.invoiceComplianceEvent.create({
    data: {
      tenantId: selfTenantId,
      invoiceId: created.id,
      // Brak dedykowanego ComplianceEventType dla self-invoice — używamy INTAKE (najogólniejszy);
      // typ "self-invoice" rozpoznajemy po payload.kind === "subscription_self_invoice".
      eventType: "INTAKE",
      payload: {
        kind: "subscription_self_invoice",
        stripeEventId: payload.stripeEventId,
        paymentMethod: payload.paymentMethod,
        amountPaidPln: payload.amountPaidPln,
        customerTenantId: payload.customerTenantId,
        customerNip: billing.nip,
        periodStart: payload.periodStart.toISOString(),
        periodEnd: payload.periodEnd.toISOString(),
      } as object,
    },
  });

  console.info(
    `[self-invoice] Utworzono FV ${created.number} (id=${created.id}) dla klienta ${billing.nip}, Stripe event=${payload.stripeEventId}`,
  );

  return { invoiceId: created.id, invoiceNumber: created.number, duplicated: false };
}

function labelPaymentMethod(m: "card" | "blik" | "p24"): string {
  if (m === "blik") return "BLIK";
  if (m === "p24") return "Przelewy24";
  return "karta";
}

function formatPolishPeriod(start: Date, end: Date): string {
  const f = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
  return `${f(start)}–${f(end)}`;
}

// PRO_PLAN_PRICE_PLN jest re-exportowany do testów i wewnętrznej walidacji caller'a.
export { PRO_PLAN_PRICE_PLN };
