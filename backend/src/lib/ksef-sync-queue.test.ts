import { describe, expect, it } from "vitest";
import { decideAutoDedupeAction } from "./ksef-sync-queue.js";

describe("decideAutoDedupeAction (auto-ksef jobId dedupe)", () => {
  it("brak istniejacego joba -> add", () => {
    expect(decideAutoDedupeAction(null)).toBe("add");
  });

  it("stany pending -> skip (anti-stacking limit MF)", () => {
    for (const s of ["waiting", "delayed", "active", "waiting-children"]) {
      expect(decideAutoDedupeAction(s)).toBe("skip");
    }
  });

  it("completed -> replace (REGRESSION: auto-sync nie moze zamrzec po 1. runie)", () => {
    expect(decideAutoDedupeAction("completed")).toBe("replace");
  });

  it("failed -> replace", () => {
    expect(decideAutoDedupeAction("failed")).toBe("replace");
  });

  it("nieznany stan -> replace (bezpieczny default odblokowuje q.add)", () => {
    expect(decideAutoDedupeAction("unknown")).toBe("replace");
  });
});
