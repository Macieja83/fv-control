import { describe, expect, it } from "vitest";
import { decideReconcile } from "./ksef-outbound-reconcile.service.js";

describe("decideReconcile", () => {
  it("accepted + ksefNumber => finalize", () => {
    expect(decideReconcile({ outcome: "accepted", ksefNumber: "K-1" })).toBe("finalize");
  });
  it("accepted bez numeru => skip (jeszcze nieprzetworzona)", () => {
    expect(decideReconcile({ outcome: "accepted" })).toBe("skip");
  });
  it("rejected => reject", () => {
    expect(decideReconcile({ outcome: "rejected", statusCode: 415 })).toBe("reject");
  });
  it("pending / not-found => skip", () => {
    expect(decideReconcile({ outcome: "pending" })).toBe("skip");
    expect(decideReconcile({ outcome: "not-found" })).toBe("skip");
  });
});
