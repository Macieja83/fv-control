import { describe, expect, it } from "vitest";
import { foldForPdfText } from "./ksef-invoice-summary-pdf.js";

describe("foldForPdfText", () => {
  it("transliteruje polskie znaki (Ł w nazwie firmy)", () => {
    expect(foldForPdfText('"CENTRUM DYSTRYBUCJI ICC PASŁEK" Ewa Tomczyńska')).toBe(
      '"CENTRUM DYSTRYBUCJI ICC PASLEK" Ewa Tomczynska',
    );
  });
});
