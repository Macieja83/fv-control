import { describe, expect, it } from "vitest";

/** Backoff helper used by workers (mirror policy in BullMQ config). */
export function exponentialDelayMs(attempt: number, baseMs: number): number {
  return baseMs * 2 ** Math.max(0, attempt - 1);
}

describe("retry / idempotency helpers", () => {
  it("exponential backoff grows", () => {
    expect(exponentialDelayMs(1, 5000)).toBe(5000);
    expect(exponentialDelayMs(2, 5000)).toBe(10000);
    expect(exponentialDelayMs(3, 5000)).toBe(20000);
  });

  it("idempotency key should include tenant + route + body hash (concept)", () => {
    const key = "tenant-1:POST /invoices:sha256-abc";
    expect(key).toContain("tenant-1");
    expect(key).toContain("POST");
  });
});
