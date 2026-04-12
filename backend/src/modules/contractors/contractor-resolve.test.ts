import { describe, expect, it } from "vitest";
import { polishNipDigits10 } from "./contractor-resolve.js";

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
