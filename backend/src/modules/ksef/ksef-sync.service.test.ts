import { describe, expect, it } from "vitest";
import { nextMetadataQueryFrom, createInvoiceXmlThrottle } from "./ksef-sync.service.js";
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
