import type { PrismaClient } from "@prisma/client";
import { loadKsefClientForTenant } from "../ksef/ksef-tenant-credentials.service.js";
import {
  continuationTokenOf,
  findSessionInvoiceResult,
  type SessionInvoiceLookup,
} from "../ksef/ksef-client.js";

export type ReconcileAction = "finalize" | "reject" | "skip";

/** Czysta decyzja na podstawie wyniku lookup faktury w sesji KSeF. */
export function decideReconcile(lookup: SessionInvoiceLookup): ReconcileAction {
  if (lookup.outcome === "accepted" && lookup.ksefNumber) return "finalize";
  if (lookup.outcome === "rejected") return "reject";
  return "skip";
}

export type ReconcileSummary = {
  candidates: number;
  checked: number;
  finalized: number;
  rejected: number;
  skipped: number;
  errors: string[];
};

type RawPayload = Record<string, unknown>;

/**
 * Async finalizacja outbound FV: dla SALE ksefRequired PENDING z zapamiętanym
 * sessionRef + invoiceReferenceNumber dociąga numer KSeF + UPO (GET /sessions/{ref}/invoices).
 * Idempotentne; bez sessionRef/invoiceRef lub bez creds = skip. NIE rzuca w górę.
 */
export async function reconcileOutboundKsef(
  prisma: PrismaClient,
  opts?: { limit?: number },
): Promise<ReconcileSummary> {
  const limit = opts?.limit ?? 50;
  const candidates = await prisma.invoice.findMany({
    where: {
      ksefRequired: true,
      ledgerKind: "SALE",
      ksefNumber: null,
      ksefStatus: "PENDING",
    },
    select: { id: true, tenantId: true, number: true, ksefReferenceId: true, rawPayload: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const summary: ReconcileSummary = {
    candidates: candidates.length,
    checked: 0,
    finalized: 0,
    rejected: 0,
    skipped: 0,
    errors: [],
  };

  for (const inv of candidates) {
    const rp: RawPayload =
      inv.rawPayload && typeof inv.rawPayload === "object"
        ? (inv.rawPayload as RawPayload)
        : {};
    const sessionRef =
      typeof rp.ksefSessionRef === "string" && rp.ksefSessionRef
        ? rp.ksefSessionRef
        : inv.ksefReferenceId && !inv.ksefReferenceId.startsWith("stub-")
          ? inv.ksefReferenceId
          : null;
    const invoiceRef =
      typeof rp.ksefInvoiceReferenceNumber === "string" && rp.ksefInvoiceReferenceNumber
        ? rp.ksefInvoiceReferenceNumber
        : null;
    if (!sessionRef || !invoiceRef) {
      summary.skipped++;
      continue;
    }

    summary.checked++;
    try {
      const client = await loadKsefClientForTenant(prisma, inv.tenantId);
      if (!client) {
        summary.skipped++;
        continue;
      }
      await client.authenticate();

      let token: string | undefined;
      let lookup: SessionInvoiceLookup = { outcome: "not-found" };
      do {
        const page = await client.getSessionInvoices(sessionRef, token);
        lookup = findSessionInvoiceResult(page, invoiceRef);
        if (lookup.outcome !== "not-found") break;
        token = continuationTokenOf(page);
      } while (token);

      const action = decideReconcile(lookup);
      if (action === "finalize" && lookup.ksefNumber) {
        const ksefNumber = lookup.ksefNumber;
        let upoXml: string | null = null;
        try {
          upoXml = await client.getSessionInvoiceUpoByKsef(sessionRef, ksefNumber);
        } catch {
          /* UPO best-effort — numer i tak finalizujemy, UPO dociągnie kolejny przebieg */
        }
        await prisma.$transaction(async (tx) => {
          await tx.invoice.update({
            where: { id: inv.id },
            data: {
              ksefStatus: "SENT",
              ksefNumber,
              rawPayload: {
                ...rp,
                ...(upoXml ? { ksefUpoXml: upoXml } : {}),
                ksefReconciledAt: new Date().toISOString(),
              } as object,
            },
          });
          await tx.invoiceComplianceEvent.create({
            data: {
              tenantId: inv.tenantId,
              invoiceId: inv.id,
              eventType: "KSEF_SUBMIT_REQUESTED",
              payload: {
                phase: "reconciled-accepted",
                sessionRef,
                invoiceReferenceNumber: invoiceRef,
                ksefNumber,
                upoStored: Boolean(upoXml),
              } as object,
            },
          });
        });
        summary.finalized++;
      } else if (action === "reject") {
        await prisma.$transaction(async (tx) => {
          await tx.invoice.update({
            where: { id: inv.id },
            data: { ksefStatus: "REJECTED" },
          });
          await tx.invoiceComplianceEvent.create({
            data: {
              tenantId: inv.tenantId,
              invoiceId: inv.id,
              eventType: "KSEF_SUBMIT_REQUESTED",
              payload: {
                phase: "reconciled-rejected",
                sessionRef,
                invoiceReferenceNumber: invoiceRef,
                statusCode: lookup.statusCode ?? null,
                statusDescription: lookup.statusDescription ?? null,
              } as object,
            },
          });
        });
        summary.rejected++;
      } else {
        summary.skipped++;
      }
    } catch (e) {
      summary.errors.push(`${inv.number}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return summary;
}
