import { describe, expect, it } from "vitest";
import { pickContractorIdForNormalizedNip, polishNipDigits10 } from "./contractor-resolve.js";

describe("polishNipDigits10", () => {
  it("strips separators", () => {
    expect(polishNipDigits10("527-000-00-00")).toBe("5270000000");
    expect(polishNipDigits10("527 000 00 00")).toBe("5270000000");
  });

  it("handles PL VAT style suffix", () => {
    expect(polishNipDigits10("PL5270000000")).toBe("5270000000");
  });

  it("returns null for short garbage", () => {
    expect(polishNipDigits10("123")).toBeNull();
  });
});

describe("pickContractorIdForNormalizedNip", () => {
  const t0 = new Date("2020-01-01");
  const t1 = new Date("2021-06-01");

  it("prefers non-auto name when two rows share normalized NIP", () => {
    const id = pickContractorIdForNormalizedNip(
      [
        { id: "stub", nip: "5270000000", name: "Kontrahent 5270000000", createdAt: t0 },
        { id: "real", nip: "527-000-00-00", name: "ACME Sp. z o.o.", createdAt: t1 },
      ],
      "5270000000",
    );
    expect(id).toBe("real");
  });

  it("prefers older row when both are generic", () => {
    const id = pickContractorIdForNormalizedNip(
      [
        { id: "a", nip: "5270000000", name: "Kontrahent 5270000000", createdAt: t1 },
        { id: "b", nip: "5270000000", name: "Kontrahent 5270000000", createdAt: t0 },
      ],
      "5270000000",
    );
    expect(id).toBe("b");
  });
});
