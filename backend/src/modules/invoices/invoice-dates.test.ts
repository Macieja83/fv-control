import { describe, expect, it } from "vitest";
import { normalizeDueDateStringToYmd, parseInvoiceDate, parseIssueDateCalendarYmd } from "./invoice-dates.js";

describe("parseIssueDateCalendarYmd", () => {
  const fb = new Date("2020-01-15T00:00:00.000Z");

  it("uses YYYY-MM-DD prefix for plain calendar date", () => {
    const d = parseIssueDateCalendarYmd("2026-04-01", fb);
    expect(d.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("uses calendar prefix when full ISO has offset (avoid wrong UTC day)", () => {
    const d = parseIssueDateCalendarYmd("2026-04-01T00:00:00.000+02:00", fb);
    expect(d.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("falls back when string is empty", () => {
    expect(parseIssueDateCalendarYmd("", fb).getTime()).toBe(fb.getTime());
  });

  it("parseInvoiceDate on plain YMD matches calendar helper", () => {
    expect(parseIssueDateCalendarYmd("2026-04-11", fb).getTime()).toBe(parseInvoiceDate("2026-04-11").getTime());
  });
});

describe("normalizeDueDateStringToYmd", () => {
  it("accepts ISO at start", () => {
    expect(normalizeDueDateStringToYmd("2026-04-15")).toBe("2026-04-15");
    expect(normalizeDueDateStringToYmd("2026-04-15T12:00:00Z")).toBe("2026-04-15");
  });

  it("finds ISO inside Polish label text", () => {
    expect(normalizeDueDateStringToYmd("płatność do 2026-04-20")).toBe("2026-04-20");
  });

  it("parses DD.MM.YYYY and DD/MM/YYYY (DMY)", () => {
    expect(normalizeDueDateStringToYmd("15.04.2026")).toBe("2026-04-15");
    expect(normalizeDueDateStringToYmd("15/04/2026")).toBe("2026-04-15");
    expect(normalizeDueDateStringToYmd("5.4.2026")).toBe("2026-04-05");
  });

  it("returns undefined for invalid calendar day", () => {
    expect(normalizeDueDateStringToYmd("31.02.2026")).toBeUndefined();
    expect(normalizeDueDateStringToYmd("")).toBeUndefined();
  });
});
