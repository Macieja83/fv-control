import { describe, expect, it } from "vitest";
import { describeErrorWithCause, imapFailureDetailForLogs } from "./zenbox-imap-errors.js";

describe("imapFailureDetailForLogs", () => {
  it("includes imapflow response fields when message is generic", () => {
    const err = new Error("Command failed") as Error & {
      responseStatus: string;
      responseText: string;
    };
    err.responseStatus = "NO";
    err.responseText = "[AUTHENTICATIONFAILED] Invalid credentials";
    expect(imapFailureDetailForLogs(err)).toContain("AUTHENTICATIONFAILED");
    expect(imapFailureDetailForLogs(err)).toContain("imap=NO");
  });

  it("chains Error.cause in describeErrorWithCause", () => {
    const inner = new Error("inner");
    const outer = new Error("outer", { cause: inner });
    expect(describeErrorWithCause(outer)).toContain("inner");
  });
});
