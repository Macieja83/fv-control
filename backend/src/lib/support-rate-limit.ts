/**
 * Anty-spam dla B18 customer chat widget (spec decyzja #6: 5 tickets/h per tenant,
 * 30 msg/h per ticket). Redis-first (działa między instancjami), fallback in-memory.
 * Wzorzec spójny z `ksef-manual-sync-rate-limit.ts`.
 */
import { getRedisConnection } from "./redis-connection.js";

type Bucket = { windowStart: number; count: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 4096;

function pruneBuckets(targetSize: number): void {
  if (buckets.size <= targetSize) return;
  const drop = buckets.size - targetSize;
  let i = 0;
  for (const k of buckets.keys()) {
    buckets.delete(k);
    i++;
    if (i >= drop) break;
  }
}

/**
 * `scope` = np. "ticket" / "message"; `id` = tenantId lub ticketId.
 * `max <= 0` lub `windowMs <= 0` => limit wyłączony.
 */
export async function consumeSupportRateToken(
  scope: string,
  id: string,
  max: number,
  windowMs: number,
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  if (max <= 0 || windowMs <= 0) return { ok: true };

  const mapKey = `${scope}:${id}`;
  const redisKey = `support:rl:${mapKey}`;
  try {
    const redis = getRedisConnection();
    const tx = redis.multi();
    tx.incr(redisKey);
    tx.pexpire(redisKey, windowMs, "NX");
    tx.pttl(redisKey);
    const out = await tx.exec();
    if (out) {
      const count = Number(out[0]?.[1] ?? 0);
      const ttlMs = Number(out[2]?.[1] ?? -1);
      if (count > max) {
        const retryAfterSec = Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : windowMs) / 1000));
        return { ok: false, retryAfterSec };
      }
      return { ok: true };
    }
  } catch {
    // Fallback in-process poniżej.
  }

  const now = Date.now();
  let b = buckets.get(mapKey);
  if (!b || now - b.windowStart >= windowMs) {
    b = { windowStart: now, count: 0 };
    buckets.set(mapKey, b);
  }
  if (b.count >= max) {
    const retryAfterMs = Math.max(0, windowMs - (now - b.windowStart));
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  b.count += 1;
  if (buckets.size > MAX_BUCKETS) pruneBuckets(Math.floor(MAX_BUCKETS / 2));
  return { ok: true };
}
