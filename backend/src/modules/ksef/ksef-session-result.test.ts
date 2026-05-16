import { describe, expect, it } from "vitest";
import {
  continuationTokenOf,
  extractInvoiceReferenceNumber,
  findSessionInvoiceResult,
} from "./ksef-client.js";

describe("extractInvoiceReferenceNumber", () => {
  it("camelCase + PascalCase + referenceNumber fallback", () => {
    expect(extractInvoiceReferenceNumber({ invoiceReferenceNumber: "INV-1" })).toBe("INV-1");
    expect(extractInvoiceReferenceNumber({ InvoiceReferenceNumber: "INV-2" })).toBe("INV-2");
    expect(extractInvoiceReferenceNumber({ referenceNumber: "REF-3" })).toBe("REF-3");
  });
  it("brak / zly typ => null", () => {
    expect(extractInvoiceReferenceNumber({})).toBeNull();
    expect(extractInvoiceReferenceNumber(null)).toBeNull();
    expect(extractInvoiceReferenceNumber({ invoiceReferenceNumber: 5 })).toBeNull();
  });
});

describe("continuationTokenOf", () => {
  it("oba casingi, pusty => undefined", () => {
    expect(continuationTokenOf({ continuationToken: "T1" })).toBe("T1");
    expect(continuationTokenOf({ ContinuationToken: "T2" })).toBe("T2");
    expect(continuationTokenOf({ continuationToken: "" })).toBeUndefined();
    expect(continuationTokenOf(null)).toBeUndefined();
  });
});

describe("findSessionInvoiceResult", () => {
  const accepted = {
    invoices: [
      { invoiceReferenceNumber: "A", ksefNumber: "8393028257-20260516-AAA-01", status: { code: 200 } },
    ],
  };
  it("accepted => ksefNumber", () => {
    const r = findSessionInvoiceResult(accepted, "A");
    expect(r.outcome).toBe("accepted");
    expect(r.ksefNumber).toBe("8393028257-20260516-AAA-01");
  });
  it("PascalCase Invoices/Status", () => {
    const r = findSessionInvoiceResult(
      { Invoices: [{ InvoiceReferenceNumber: "B", KsefNumber: "K-2", Status: { Code: 200 } }] },
      "B",
    );
    expect(r.outcome).toBe("accepted");
    expect(r.ksefNumber).toBe("K-2");
  });
  it("rejected (status >=400, brak ksefNumber)", () => {
    const r = findSessionInvoiceResult(
      { invoices: [{ invoiceReferenceNumber: "C", status: { code: 415, description: "Blad" } }] },
      "C",
    );
    expect(r.outcome).toBe("rejected");
    expect(r.statusCode).toBe(415);
  });
  it("pending (jest, brak numeru i brak bledu)", () => {
    const r = findSessionInvoiceResult(
      { invoices: [{ invoiceReferenceNumber: "D", status: { code: 100 } }] },
      "D",
    );
    expect(r.outcome).toBe("pending");
  });
  it("not-found gdy brak refu / zla struktura", () => {
    expect(findSessionInvoiceResult(accepted, "ZZZ").outcome).toBe("not-found");
    expect(findSessionInvoiceResult({}, "A").outcome).toBe("not-found");
    expect(findSessionInvoiceResult(null, "A").outcome).toBe("not-found");
  });
});
