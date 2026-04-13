import { describe, expect, it } from "vitest";
import { parseInvoiceDate, parseIssueDateCalendarYmd } from "./invoice-dates.js";

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
