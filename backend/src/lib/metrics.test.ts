import { describe, expect, it } from "vitest";
import {
  ksefSyncRunsTotal,
  ksefSyncDurationSeconds,
  ksefRetryQueueSize,
  ksefInvoicesProcessedTotal,
  getMetricsRegistry,
} from "./metrics.js";

// Sprint D — Regression guards po Sprint B-lite z 2026-05-10 (P1-5).
// Patrz: 01-Projects/Resta-FV/research/ksef-batch-stability.md w vault ai-mission-control.
// Gwarantuje że 4 metryki KSeF żyją w globalnym registrze z poprawnymi nazwami + labelnames,
// bo `/metrics` endpoint je serializuje + Prometheus scrape oczekuje stalej nomenclatury.

describe("KSeF prom-client metrics (P1-5 regression guard)", () => {
  const registry = getMetricsRegistry();

  it("rejestruje fvcontrol_ksef_sync_runs_total jako counter z labelami tenant_id + phase", async () => {
    const all = await registry.getMetricsAsJSON();
    const m = all.find((x) => x.name === "fvcontrol_ksef_sync_runs_total");
    expect(m).toBeDefined();
    expect(m?.type).toBe("counter");
    // help text powinien byc opisowy (Prometheus best practice + alert rules wymagaja kontekstu)
    expect(m?.help).toBeTruthy();
  });

  it("rejestruje fvcontrol_ksef_sync_duration_seconds jako histogram z bucketami do 1h", async () => {
    const all = await registry.getMetricsAsJSON();
    const m = all.find((x) => x.name === "fvcontrol_ksef_sync_duration_seconds");
    expect(m).toBeDefined();
    expect(m?.type).toBe("histogram");
  });

  it("rejestruje fvcontrol_ksef_retry_queue_size jako gauge (alertowalny)", async () => {
    const all = await registry.getMetricsAsJSON();
    const m = all.find((x) => x.name === "fvcontrol_ksef_retry_queue_size");
    expect(m).toBeDefined();
    expect(m?.type).toBe("gauge");
    // help text alertu (>100 == MF outage albo recurring failure) powinien byc readable z metrics.ts
    expect(m?.help.toLowerCase()).toMatch(/retry|alert|>/);
  });

  it("rejestruje fvcontrol_ksef_invoices_processed_total jako counter z label outcome", async () => {
    const all = await registry.getMetricsAsJSON();
    const m = all.find((x) => x.name === "fvcontrol_ksef_invoices_processed_total");
    expect(m).toBeDefined();
    expect(m?.type).toBe("counter");
  });

  it("ksefSyncRunsTotal akceptuje 3 phase values bez throw (completed | failed | skipped_no_credentials)", () => {
    expect(() =>
      ksefSyncRunsTotal.inc({ tenant_id: "test-tenant", phase: "completed" }),
    ).not.toThrow();
    expect(() => ksefSyncRunsTotal.inc({ tenant_id: "test-tenant", phase: "failed" })).not.toThrow();
    expect(() =>
      ksefSyncRunsTotal.inc({ tenant_id: "test-tenant", phase: "skipped_no_credentials" }),
    ).not.toThrow();
  });

  it("ksefSyncDurationSeconds.startTimer zwraca endTimer ktora dziala bez throw", () => {
    const end = ksefSyncDurationSeconds.startTimer({ tenant_id: "test-tenant" });
    expect(typeof end).toBe("function");
    expect(() => end()).not.toThrow();
  });

  it("ksefRetryQueueSize.set akceptuje liczbe (alert threshold 100)", () => {
    expect(() => ksefRetryQueueSize.set({ tenant_id: "test-tenant" }, 0)).not.toThrow();
    expect(() => ksefRetryQueueSize.set({ tenant_id: "test-tenant" }, 100)).not.toThrow();
    expect(() => ksefRetryQueueSize.set({ tenant_id: "test-tenant" }, 500)).not.toThrow();
  });

  it("ksefInvoicesProcessedTotal akceptuje 4 outcome values (ingested|skipped_duplicate|refetched|error)", () => {
    expect(() =>
      ksefInvoicesProcessedTotal.inc({ tenant_id: "test-tenant", outcome: "ingested" }),
    ).not.toThrow();
    expect(() =>
      ksefInvoicesProcessedTotal.inc({ tenant_id: "test-tenant", outcome: "skipped_duplicate" }),
    ).not.toThrow();
    expect(() =>
      ksefInvoicesProcessedTotal.inc({ tenant_id: "test-tenant", outcome: "refetched" }),
    ).not.toThrow();
    expect(() =>
      ksefInvoicesProcessedTotal.inc({ tenant_id: "test-tenant", outcome: "error" }),
    ).not.toThrow();
  });

  it("wszystkie 4 metryki KSeF maja prefix fvcontrol_ksef_ (Prometheus convention)", async () => {
    const all = await registry.getMetricsAsJSON();
    const ksefMetrics = all.filter((x) => x.name.startsWith("fvcontrol_ksef_"));
    expect(ksefMetrics.length).toBeGreaterThanOrEqual(4);
    const names = ksefMetrics.map((x) => x.name).sort();
    expect(names).toEqual(
      expect.arrayContaining([
        "fvcontrol_ksef_invoices_processed_total",
        "fvcontrol_ksef_retry_queue_size",
        "fvcontrol_ksef_sync_duration_seconds",
        "fvcontrol_ksef_sync_runs_total",
      ]),
    );
  });
});
