import { describe, it, expect, vi } from "vitest";

// Brak Redis w env testowym -> mock wymusza deterministyczny fallback in-memory
// (i szybkie testy bez 60s timeoutu na próbie połączenia ioredis).
vi.mock("./redis-connection.js", () => ({
  getRedisConnection: () => {
    throw new Error("no redis in test");
  },
}));

const { consumeSupportRateToken } = await import("./support-rate-limit.js");

describe("consumeSupportRateToken (in-memory fallback)", () => {
  it("limit wyłączony gdy max <= 0", async () => {
    const r = await consumeSupportRateToken("ticket", "a", 0, 60_000);
    expect(r.ok).toBe(true);
  });

  it("limit wyłączony gdy windowMs <= 0", async () => {
    const r = await consumeSupportRateToken("ticket", "b", 5, 0);
    expect(r.ok).toBe(true);
  });

  it("przepuszcza do max, blokuje powyżej z retryAfterSec", async () => {
    const id = `tenant-${Math.random().toString(36).slice(2)}`;
    const max = 3;
    for (let i = 0; i < max; i++) {
      const ok = await consumeSupportRateToken("ticket", id, max, 60_000);
      expect(ok.ok).toBe(true);
    }
    const blocked = await consumeSupportRateToken("ticket", id, max, 60_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
      expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
    }
  });

  it("różne scope dla tego samego id nie kolidują", async () => {
    const id = `iso-${Math.random().toString(36).slice(2)}`;
    const a = await consumeSupportRateToken("ticket", id, 1, 60_000);
    const b = await consumeSupportRateToken("message", id, 1, 60_000);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // drugi raz ten sam scope+id -> blok (max=1)
    const a2 = await consumeSupportRateToken("ticket", id, 1, 60_000);
    expect(a2.ok).toBe(false);
  });

  it("nowe okno resetuje licznik", async () => {
    const id = `win-${Math.random().toString(36).slice(2)}`;
    const first = await consumeSupportRateToken("ticket", id, 1, 1);
    expect(first.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    const afterWindow = await consumeSupportRateToken("ticket", id, 1, 1);
    expect(afterWindow.ok).toBe(true);
  });
});
