/**
 * Manualna/cron rekoncyliacja outbound KSeF: dla SALE ksefRequired PENDING
 * dociąga numer KSeF + UPO z sesji online (KSeF v2 async).
 * Użycie: npm run reconcile:ksef-outbound  (opcjonalnie LIMIT=N)
 */
import { PrismaClient } from "@prisma/client";
import { reconcileOutboundKsef } from "../src/modules/invoices/ksef-outbound-reconcile.service.js";

const prisma = new PrismaClient();

(async () => {
  const limit = Number(process.env.LIMIT ?? "50") || 50;
  const summary = await reconcileOutboundKsef(prisma, { limit });
  console.log("[reconcile-ksef-outbound]", JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("[reconcile-ksef-outbound] ERROR", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
