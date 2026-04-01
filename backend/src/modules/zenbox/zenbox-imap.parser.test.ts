import { describe, expect, it } from "vitest";
import {
  isInvoiceCandidateAttachment,
  normalizeAttachmentFilename,
  shouldResetCursorOnUidValidityChange,
  stableExternalMessageId,
} from "./zenbox-imap.parser.js";

describe("zenbox-imap.parser", () => {
  it("stableExternalMessageId prefers Message-ID header", () => {
    expect(stableExternalMessageId("<abc@host>", "1", 42n)).toBe("<abc@host>");
  });

  it("stableExternalMessageId falls back to UID when header missing", () => {
    expect(stableExternalMessageId(undefined, "9", 42n)).toBe("imap:9:42");
  });

  it("shouldResetCursorOnUidValidityChange when stored differs from current", () => {
    expect(shouldResetCursorOnUidValidityChange("1", "2")).toBe(true);
    expect(shouldResetCursorOnUidValidityChange("1", "1")).toBe(false);
    expect(shouldResetCursorOnUidValidityChange(null, "1")).toBe(false);
    expect(shouldResetCursorOnUidValidityChange("1", null)).toBe(false);
  });

  it("isInvoiceCandidateAttachment allows PDF and filename hints", () => {
    expect(isInvoiceCandidateAttachment("FV_2026_01.pdf", "application/pdf")).toBe(true);
    expect(isInvoiceCandidateAttachment("random.bin", "application/pdf")).toBe(true);
    expect(isInvoiceCandidateAttachment("note.txt", "text/plain")).toBe(false);
    expect(isInvoiceCandidateAttachment("faktura.xml", "application/xml")).toBe(true);
  });

  it("normalizeAttachmentFilename sanitizes path segments", () => {
    expect(normalizeAttachmentFilename("a/b\\c.pdf", 0)).toBe("a_b_c.pdf");
    expect(normalizeAttachmentFilename("", 3)).toBe("attachment-3");
  });
});
