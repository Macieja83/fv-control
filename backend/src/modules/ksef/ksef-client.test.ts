import { describe, expect, it } from "vitest";
import { MAX_AUTH_POLL_ATTEMPTS, AUTH_POLL_INTERVAL_MS } from "./ksef-client.js";

// Sprint D — Regression guards po Sprint A/B/C z 2026-05-10.
// Patrz: 01-Projects/Resta-FV/research/ksef-batch-stability.md (P2-8) w vault ai-mission-control.

describe("ksef-client constants (P2-8 regression guard)", () => {
  it("MAX_AUTH_POLL_ATTEMPTS = 40 (bump z 20 dla peak hours MF, np. 10 dnia miesiaca deadline JPK)", () => {
    expect(MAX_AUTH_POLL_ATTEMPTS).toBe(40);
  });

  it("AUTH_POLL_INTERVAL_MS = 3000 (krok 3s, niezmieniony — granularity raportowania)", () => {
    expect(AUTH_POLL_INTERVAL_MS).toBe(3_000);
  });

  it("calkowity budzet polling auth >= 120s (40 prob x 3s)", () => {
    const totalBudgetMs = MAX_AUTH_POLL_ATTEMPTS * AUTH_POLL_INTERVAL_MS;
    expect(totalBudgetMs).toBeGreaterThanOrEqual(120_000);
    expect(totalBudgetMs).toBeLessThanOrEqual(180_000); // sanity: nie wiecej niz 3 min
  });
});
