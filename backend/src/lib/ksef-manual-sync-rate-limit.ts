/**
 * Prosty limiter in-process per tenant dla ręcznego kolejkowania sync KSeF.
 * (Po `authenticate` — klucz to `tenantId`, nie IP.)
 */

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
 * Zwraca `ok: false` gdy w bieżącym oknie czasu wykorzystano już `max` żądań.
 * `max === 0` lub `windowMs === 0` — limit wyłączony.
 */
export function consumeKsefManualSyncRateToken(
  tenantId: string,
  max: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  if (max <= 0 || windowMs <= 0) return { ok: true };

  const now = Date.now();
  let b = buckets.get(tenantId);
  if (!b || now - b.windowStart >= windowMs) {
    b = { windowStart: now, count: 0 };
    buckets.set(tenantId, b);
  }

  if (b.count >= max) {
    const retryAfterMs = Math.max(0, windowMs - (now - b.windowStart));
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  b.count += 1;
  if (buckets.size > MAX_BUCKETS) {
    pruneBuckets(Math.floor(MAX_BUCKETS / 2));
  }
  return { ok: true };
}
