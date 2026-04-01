import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { IdempotencyKey } from "@prisma/client";
import { loadConfig } from "../config.js";
import { AppError } from "./errors.js";
import { idempotencyConflictTotal, idempotencyReplayTotal } from "./metrics.js";

const POLL_MS = 40;
const IN_FLIGHT_MAX_WAIT_MS = 30_000;
const TX_RETRY = 8;

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export type IdempotencyTxResult =
  | { kind: "created"; slotId: string }
  | { kind: "replay"; row: IdempotencyKey }
  | { kind: "conflict" }
  | { kind: "in_flight" };

async function idempotencyTransactionStep(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    idempotencyKey: string;
    routeFingerprint: string;
    requestHash: string;
  },
): Promise<IdempotencyTxResult> {
  const { tenantId, idempotencyKey, routeFingerprint, requestHash } = params;
  await tx.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))`,
    tenantId,
    `${idempotencyKey}:${routeFingerprint}`,
  );

  const now = new Date();
  const cfg = loadConfig();
  const defaultTtlMs = cfg.IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000;

  let row = await tx.idempotencyKey.findUnique({
    where: {
      tenantId_idempotencyKey_routeFingerprint: { tenantId, idempotencyKey, routeFingerprint },
    },
  });

  if (row && row.expiresAt < now) {
    await tx.idempotencyKey.delete({ where: { id: row.id } });
    row = null;
  }

  if (!row) {
    const created = await tx.idempotencyKey.create({
      data: {
        tenantId,
        idempotencyKey,
        routeFingerprint,
        requestHash,
        lifecycle: "IN_FLIGHT",
        responseStatus: null,
        expiresAt: new Date(Date.now() + defaultTtlMs),
      },
    });
    return { kind: "created", slotId: created.id };
  }

  if (row.lifecycle === "COMPLETED") {
    if (row.requestHash !== requestHash) {
      return { kind: "conflict" };
    }
    return { kind: "replay", row };
  }

  return { kind: "in_flight" };
}

export async function claimOrResolveIdempotency(
  prisma: PrismaClient,
  params: {
    tenantId: string;
    idempotencyKey: string;
    routeFingerprint: string;
    requestHash: string;
  },
): Promise<
  | { action: "proceed"; slotId: string }
  | { action: "replay"; statusCode: number; body: unknown }
  | { action: "conflict" }
> {
  const deadline = Date.now() + IN_FLIGHT_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    let step: IdempotencyTxResult | undefined;
    for (let t = 0; t < TX_RETRY; t++) {
      try {
        step = await prisma.$transaction(
          (tx) => idempotencyTransactionStep(tx, params),
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 },
        );
        break;
      } catch (e) {
        if (isUniqueViolation(e)) {
          continue;
        }
        throw e;
      }
    }
    if (!step) {
      throw AppError.internal("Idempotency claim failed after retries");
    }

    if (step.kind === "created") {
      return { action: "proceed", slotId: step.slotId };
    }
    if (step.kind === "replay") {
      idempotencyReplayTotal.inc();
      const status = step.row.responseStatus ?? 200;
      const body = step.row.responseBody ?? {};
      return { action: "replay", statusCode: status, body };
    }
    if (step.kind === "conflict") {
      idempotencyConflictTotal.inc();
      return { action: "conflict" };
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  throw AppError.unavailable("Idempotency-Key request still in progress; retry later");
}
