import { describe, expect, it } from "vitest";
import { issueYmdEmbeddedInKsefNumber } from "./ksef-metadata-draft.js";

describe("issueYmdEmbeddedInKsefNumber", () => {
  it("parses MF-style KSeF number", () => {
    expect(issueYmdEmbeddedInKsefNumber("5220002860-20260401-46DDD3800023-2A")).toBe("2026-04-01");
  });

  it("returns null for invalid", () => {
    expect(issueYmdEmbeddedInKsefNumber("")).toBeNull();
    expect(issueYmdEmbeddedInKsefNumber("nope")).toBeNull();
  });
});
