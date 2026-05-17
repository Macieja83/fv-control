/**
 * B15-FU1 — Neutralizacja testowych self-FV dogfood (`FA/2026-05/001` + `FA/2026-05/002`).
 *
 * Kontekst: 2 self-FV TT Grupa powstały podczas testu dogfood B15 (real BLIK 67 PLN, 2026-05-13)
 * z błędnym nabywcą. Oba `ksefStatus=PENDING`, `ksefNumber=null` → NIGDY nie weszły do KSeF.
 * Księgowa 2026-05-17: testy, brak obowiązku VAT. Decyzja Marcina 2026-05-17: Opcja A —
 * neutralizacja (terminalny nie-submittowalny `ksefStatus`) by `reconcileOutboundKsef`
 * (filtr `ksefStatus=PENDING`) nigdy ich nie wysłał. Bez zmian schematu.
 * Detail: ai-mission-control `01-Projects/Resta-FV/research/b15-fu1-test-fv-cleanup-decision.md`.
 *
 * Neutralny status = `NOT_APPLICABLE` (istnieje w enumie `KsefWorkflowStatus`, to też stan
 * inicjalny self-FV przed submit; wyklucza z reconcile candidate query). Poprzedni status +
 * powód zapisywane w `Invoice.rawPayload.b15fu1Neutralized` + audit `InvoiceComplianceEvent` FLAGGED.
 *
 * Uruchom (VPS, prod env, backup Invoice ZROBIONY wcześniej):
 *   cd backend && npx tsx scripts/neutralize-b15-fu1-test-self-invoices.ts          # dry-run (default)
 *   cd backend && npx tsx scripts/neutralize-b15-fu1-test-self-invoices.ts --apply  # mutacja
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const TARGET_NUMBERS = ["FA/2026-05/001", "FA/2026-05/002"] as const;
const NEUTRAL_STATUS = "NOT_APPLICABLE" as const;
const DECISION_REF = "B15-FU1 / Opcja A / decyzja Marcina 2026-05-17";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  console.info(
    `[b15-fu1] tryb=${APPLY ? "APPLY (mutacja prod)" : "DRY-RUN (bez zmian)"} ; cel=${TARGET_NUMBERS.join(", ")}`,
  );

  // Selektor: numer z listy + dogfood self-FV niezarejestrowane w KSeF. Nigdy nie tykamy
  // dokumentu z numerem KSeF (ksefNumber != null) — twardy guard niżej.
  const matched = await prisma.invoice.findMany({
    where: {
      number: { in: [...TARGET_NUMBERS] },
      ledgerKind: "SALE",
      ksefRequired: true,
      ksefStatus: "PENDING",
      ksefNumber: null,
    },
    select: {
      id: true,
      tenantId: true,
      number: true,
      ksefStatus: true,
      ksefNumber: true,
      ksefReferenceId: true,
      grossTotal: true,
      createdAt: true,
      rawPayload: true,
    },
    orderBy: { number: "asc" },
  });

  for (const inv of matched) {
    console.info(
      `[b15-fu1] match id=${inv.id} tenant=${inv.tenantId} number=${inv.number} ` +
        `ksefStatus=${inv.ksefStatus} ksefNumber=${inv.ksefNumber ?? "null"} ` +
        `ref=${inv.ksefReferenceId ?? "null"} gross=${String(inv.grossTotal)} created=${inv.createdAt.toISOString()}`,
    );
  }

  // Guard 1: dokładnie 2 trafienia (FA/001 + FA/002). Inaczej STOP — nie zgadujemy.
  if (matched.length !== TARGET_NUMBERS.length) {
    console.error(
      `[b15-fu1] STOP: oczekiwano ${TARGET_NUMBERS.length} faktur, znaleziono ${matched.length}. ` +
        `Brak mutacji. Sprawdź ręcznie stan prod (numery / ksefStatus / ksefNumber).`,
    );
    process.exitCode = 1;
    return;
  }

  // Guard 2: żadna nie może mieć numeru KSeF (gdyby worker zdążył ją zarejestrować —
  // wtedy ścieżka to faktura korygująca, NIE neutralizacja; patrz pack Opcja C).
  const registered = matched.filter((i) => i.ksefNumber !== null);
  if (registered.length > 0) {
    console.error(
      `[b15-fu1] STOP: ${registered.length} faktur ma już numer KSeF (${registered
        .map((i) => `${i.number}=${i.ksefNumber}`)
        .join(", ")}). Neutralizacja niedozwolona — eskalacja do faktury korygującej (Opcja C).`,
    );
    process.exitCode = 1;
    return;
  }

  // Kontekst (pack §8 Q3): inne PENDING SALE self-FV tego samego tenanta — tylko raport.
  const tenantIds = [...new Set(matched.map((i) => i.tenantId))];
  const otherPending = await prisma.invoice.findMany({
    where: {
      tenantId: { in: tenantIds },
      ledgerKind: "SALE",
      ksefRequired: true,
      ksefStatus: "PENDING",
      ksefNumber: null,
      number: { notIn: [...TARGET_NUMBERS] },
    },
    select: { id: true, tenantId: true, number: true, createdAt: true },
  });
  if (otherPending.length > 0) {
    console.warn(
      `[b15-fu1] UWAGA: ${otherPending.length} INNYCH PENDING SALE self-FV dla tych tenantów ` +
        `(NIE tykane przez ten skrypt): ${otherPending
          .map((i) => `${i.number}(${i.id})`)
          .join(", ")} — zgłoś Marcinowi, ew. osobna decyzja.`,
    );
  } else {
    console.info("[b15-fu1] Brak innych PENDING SALE self-FV dla tych tenantów (czysto).");
  }

  if (!APPLY) {
    console.info(
      `[b15-fu1] DRY-RUN koniec. Zmieniłbym ${matched.length} faktur: ksefStatus PENDING → ${NEUTRAL_STATUS} ` +
        `+ rawPayload.b15fu1Neutralized + audit FLAGGED. Uruchom z --apply by wykonać.`,
    );
    return;
  }

  let changed = 0;
  for (const inv of matched) {
    const prevRaw =
      inv.rawPayload && typeof inv.rawPayload === "object" && !Array.isArray(inv.rawPayload)
        ? (inv.rawPayload as Prisma.JsonObject)
        : {};
    const neutralizedMeta = {
      at: new Date().toISOString(),
      reason: DECISION_REF,
      previousKsefStatus: inv.ksefStatus,
      newKsefStatus: NEUTRAL_STATUS,
      note: "Testowa self-FV dogfood B15, niezarejestrowana w KSeF; wykluczona z wysyłki (Opcja A).",
    };

    await prisma.$transaction([
      prisma.invoice.update({
        where: { id: inv.id },
        data: {
          ksefStatus: NEUTRAL_STATUS,
          rawPayload: { ...prevRaw, b15fu1Neutralized: neutralizedMeta },
        },
      }),
      prisma.invoiceComplianceEvent.create({
        data: {
          tenantId: inv.tenantId,
          invoiceId: inv.id,
          eventType: "FLAGGED",
          payload: {
            action: "B15-FU1-neutralize",
            ...neutralizedMeta,
            invoiceNumber: inv.number,
          },
        },
      }),
    ]);
    changed++;
    console.info(
      `[b15-fu1] APPLIED id=${inv.id} number=${inv.number}: ksefStatus ${inv.ksefStatus} → ${NEUTRAL_STATUS}`,
    );
  }

  // Weryfikacja po mutacji: 0 z TARGET_NUMBERS pozostaje PENDING.
  const stillPending = await prisma.invoice.count({
    where: { number: { in: [...TARGET_NUMBERS] }, ksefStatus: "PENDING" },
  });
  console.info(
    `[b15-fu1] APPLY koniec. Zmieniono ${changed} faktur. Pozostało PENDING z listy: ${stillPending} ` +
      `(oczekiwane 0). reconcileOutboundKsef (filtr ksefStatus=PENDING) już ich nie podejmie.`,
  );
  if (stillPending !== 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("[b15-fu1] ERROR", e instanceof Error ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
