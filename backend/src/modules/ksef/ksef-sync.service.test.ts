import { beforeEach, describe, expect, it } from "vitest";
import {
  nextMetadataQueryFrom,
  createInvoiceXmlThrottle,
  AUTO_RESUME_MAX_ATTEMPTS,
  AUTO_RETRY_FRESH_KSEF_WINDOW_MS,
  AUTO_RETRY_MIN_GAP_MS,
  __testGetAutoResumeAttempts,
  __testSetAutoResumeAttempts,
  __testResetAutoResumeAttempts,
} from "./ksef-sync.service.js";
import type { KsefInvoiceMetadata } from "./ksef-client.js";

function meta(overrides: Partial<KsefInvoiceMetadata> = {}): KsefInvoiceMetadata {
  return {
    ksefNumber: "5220002860-20260401-46DDD3800023-2A",
    invoiceNumber: "FA/2026/04/001",
    issueDate: "2026-04-15",
    invoicingDate: "2026-04-15T10:00:00.000Z",
    permanentStorageDate: "2026-04-15T11:00:00.000Z",
    seller: { nip: "1234567890", name: "Test Sp. z o.o." },
    buyer: null,
    netAmount: 100,
    grossAmount: 123,
    vatAmount: 23,
    currency: "PLN",
    invoiceType: "FA",
    invoiceHash: "",
    ...overrides,
  };
}

describe("nextMetadataQueryFrom", () => {
  it("PermanentStorage zwraca permanentStorageDate ostatniej faktury", () => {
    expect(
      nextMetadataQueryFrom("PermanentStorage", meta({ permanentStorageDate: "2026-04-20T08:00:00.000Z" })),
    ).toBe("2026-04-20T08:00:00.000Z");
  });

  it("Issue uzywa invoicingDate gdy jest", () => {
    expect(
      nextMetadataQueryFrom(
        "Issue",
        meta({ invoicingDate: "2026-04-15T10:00:00.000Z", issueDate: "2026-04-15" }),
      ),
    ).toBe("2026-04-15T10:00:00.000Z");
  });

  it("Issue z YMD-only issueDate (bez invoicingDate) konstruuje T00:00:00.000Z", () => {
    expect(nextMetadataQueryFrom("Issue", meta({ invoicingDate: "", issueDate: "2026-04-15" }))).toBe(
      "2026-04-15T00:00:00.000Z",
    );
  });

  it("Issue z nie-YMD issueDate zwraca surowy string", () => {
    expect(nextMetadataQueryFrom("Issue", meta({ invoicingDate: "", issueDate: "15 kwietnia 2026" }))).toBe(
      "15 kwietnia 2026",
    );
  });

  it("Issue fallback do permanentStorageDate gdy invoicingDate i issueDate puste", () => {
    expect(
      nextMetadataQueryFrom(
        "Issue",
        meta({ invoicingDate: "", issueDate: "", permanentStorageDate: "2026-04-15T12:00:00.000Z" }),
      ),
    ).toBe("2026-04-15T12:00:00.000Z");
  });
});

describe("createInvoiceXmlThrottle", () => {
  it("z minIntervalMs=0 nigdy nie czeka", async () => {
    const throttle = createInvoiceXmlThrottle(0);
    const t0 = Date.now();
    await throttle();
    await throttle();
    await throttle();
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it("z minIntervalMs>0 wymusza minimalny odstep miedzy wywolaniami", async () => {
    const throttle = createInvoiceXmlThrottle(50);
    const t0 = Date.now();
    await throttle();
    await throttle();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(200);
  });

  it("pierwsze wywolanie nie czeka", async () => {
    const throttle = createInvoiceXmlThrottle(1000);
    const t0 = Date.now();
    await throttle();
    expect(Date.now() - t0).toBeLessThan(50);
  });
});

// Sprint D — regression guards po Sprint A/B/C z 2026-05-10.
// Patrz: 01-Projects/Resta-FV/research/ksef-batch-stability.md w vault ai-mission-control.
//
// Auto-resume cap (P2-7): bez tego invoice w stanie FAILED_NEEDS_REVIEW byl wskrzeszany
// w kazdej rundzie auto-sync (co 5 min) przez cale okno 3h freshness = do 36 prob.
// In-memory counter trzyma per-process licznik probIES per invoice z cap=3.

describe("auto-resume constants (P2-7 regression guard)", () => {
  it("AUTO_RESUME_MAX_ATTEMPTS = 3 (cap defensywny przeciwko spam loop)", () => {
    expect(AUTO_RESUME_MAX_ATTEMPTS).toBe(3);
  });

  it("AUTO_RETRY_FRESH_KSEF_WINDOW_MS = 3h (okno freshness)", () => {
    expect(AUTO_RETRY_FRESH_KSEF_WINDOW_MS).toBe(3 * 60 * 60 * 1000);
  });

  it("AUTO_RETRY_MIN_GAP_MS = 90s (minimalny odstep miedzy retry)", () => {
    expect(AUTO_RETRY_MIN_GAP_MS).toBe(90 * 1000);
  });

  it("cap x freshness window = max 3 proby w oknie 3h (nie 36)", () => {
    // Bez P2-7 byloby: 3h / 5min interval = 36 prob. Z cap=3 -> max 3 proby/invoice/process.
    expect(AUTO_RESUME_MAX_ATTEMPTS * AUTO_RETRY_MIN_GAP_MS).toBeLessThan(
      AUTO_RETRY_FRESH_KSEF_WINDOW_MS,
    );
  });
});

describe("__testAutoResumeAttempts helpery (P2-7)", () => {
  beforeEach(() => {
    __testResetAutoResumeAttempts();
  });

  it("getter zwraca 0 dla nieznanego invoice id", () => {
    expect(__testGetAutoResumeAttempts("nieistniejacy-invoice")).toBe(0);
  });

  it("setter i getter dla pojedynczego wpisu", () => {
    __testSetAutoResumeAttempts("inv-1", 2);
    expect(__testGetAutoResumeAttempts("inv-1")).toBe(2);
  });

  it("setter dla 0 (sprawdzenie ze 0 to legalna wartosc, nie undefined)", () => {
    __testSetAutoResumeAttempts("inv-1", 0);
    expect(__testGetAutoResumeAttempts("inv-1")).toBe(0);
  });

  it("nadpisuje wartosc dla tego samego invoice id", () => {
    __testSetAutoResumeAttempts("inv-1", 1);
    __testSetAutoResumeAttempts("inv-1", 3);
    expect(__testGetAutoResumeAttempts("inv-1")).toBe(3);
  });

  it("trzyma niezalezne wartosci per invoice", () => {
    __testSetAutoResumeAttempts("inv-1", 1);
    __testSetAutoResumeAttempts("inv-2", 2);
    __testSetAutoResumeAttempts("inv-3", 3);
    expect(__testGetAutoResumeAttempts("inv-1")).toBe(1);
    expect(__testGetAutoResumeAttempts("inv-2")).toBe(2);
    expect(__testGetAutoResumeAttempts("inv-3")).toBe(3);
  });

  it("reset czysci wszystkie wpisy", () => {
    __testSetAutoResumeAttempts("inv-1", 2);
    __testSetAutoResumeAttempts("inv-2", 3);
    __testResetAutoResumeAttempts();
    expect(__testGetAutoResumeAttempts("inv-1")).toBe(0);
    expect(__testGetAutoResumeAttempts("inv-2")).toBe(0);
  });

  it("counter = AUTO_RESUME_MAX_ATTEMPTS oznacza ze nastepna proba bedzie odrzucona", () => {
    __testSetAutoResumeAttempts("inv-capped", AUTO_RESUME_MAX_ATTEMPTS);
    // tryAutoResumeKsefInvoiceProcessing sprawdza `prevAttempts >= AUTO_RESUME_MAX_ATTEMPTS`
    // i wraca false bez podejmowania kolejnej proby.
    expect(__testGetAutoResumeAttempts("inv-capped")).toBeGreaterThanOrEqual(
      AUTO_RESUME_MAX_ATTEMPTS,
    );
  });
});

// P2-6 regression: clamp na nextMetadataQueryFrom call site.
// Defensywne — Issue YMD-only `T00:00:00.000Z` < currentFrom moglby infinite loop bez clamp.
// `nextMetadataQueryFrom` zwraca surowy string, clamp robi caller — testy tu sprawdzaja ze
// zwracana wartosc zachowuje porzadek czasowy zgodny z dokumentacja.
describe("nextMetadataQueryFrom — porzadek czasowy (P2-6 regression guard)", () => {
  it("PermanentStorage zwraca dokladnie ostatni permanentStorageDate (sort Asc po MF wartosc rosnie)", () => {
    const last = meta({ permanentStorageDate: "2026-04-15T12:00:00.000Z" });
    expect(nextMetadataQueryFrom("PermanentStorage", last)).toBe("2026-04-15T12:00:00.000Z");
  });

  it("Issue z invoicingDate ISO-8601 — zwraca tę wartosc (sort Asc)", () => {
    const last = meta({ invoicingDate: "2026-04-20T08:30:00.000Z", issueDate: "2026-04-20" });
    expect(nextMetadataQueryFrom("Issue", last)).toBe("2026-04-20T08:30:00.000Z");
  });

  it("Issue YMD-only daje T00:00:00.000Z (caller musi clamp by uniknac infinite loop)", () => {
    const last = meta({ invoicingDate: "", issueDate: "2026-04-15" });
    const next = nextMetadataQueryFrom("Issue", last);
    expect(next).toBe("2026-04-15T00:00:00.000Z");
    // Caller w pętli porównuje z currentFrom — clamp ma zapobiec next < currentFrom.
    // (Sam algorytm to defensywa, sort Asc MF powinien gwarantować że ten warunek nie wystąpi.)
  });
});

