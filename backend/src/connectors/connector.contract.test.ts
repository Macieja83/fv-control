import { describe, expect, it } from "vitest";
import {
  createStubGmailConnector,
  createStubImapConnector,
  createStubKsefConnector,
  createStubRestaConnector,
} from "./connector.interfaces.js";

describe("connector stubs (contract shape)", () => {
  it("gmail returns cursor + refs array", async () => {
    const c = createStubGmailConnector();
    const r = await c.fetchIncremental("m1", {});
    expect(r.attachmentRefs).toEqual([]);
    expect(r.nextCursor).toHaveProperty("historyId");
  });

  it("imap returns uid fields", async () => {
    const c = createStubImapConnector();
    const r = await c.poll("m1", {});
    expect(Array.isArray(r.rawMimeIds)).toBe(true);
  });

  it("ksef listSince returns array", async () => {
    const c = createStubKsefConnector();
    const r = await c.listSince(new Date());
    expect(Array.isArray(r)).toBe(true);
  });

  it("resta listInvoices returns array", async () => {
    const c = createStubRestaConnector();
    const r = await c.listInvoices({});
    expect(Array.isArray(r)).toBe(true);
  });
});
