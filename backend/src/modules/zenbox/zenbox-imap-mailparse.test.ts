import { describe, expect, it } from "vitest";
import { parseImapRawSource } from "./zenbox-imap-mailparse.js";

function buildMultipartPdfEml(): Buffer {
  const pdfBody = Buffer.from("%PDF-1.1\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj trailer<<>>\n%%EOF\n");
  const lines = [
    "From: vendor@example.com",
    "To: inbox@zenbox.local",
    "Subject: Faktura 1/2026",
    "Message-ID: <test-msg-1@example.com>",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=\"bnd\"",
    "",
    "--bnd",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hello",
    "--bnd",
    "Content-Type: application/pdf; name=\"FV-001.pdf\"",
    "Content-Transfer-Encoding: base64",
    "",
    pdfBody.toString("base64"),
    "--bnd--",
    "",
  ];
  return Buffer.from(lines.join("\r\n"), "utf8");
}

describe("parseImapRawSource", () => {
  it("extracts invoice-candidate PDF attachment", async () => {
    const parsed = await parseImapRawSource(buildMultipartPdfEml());
    expect(parsed.messageIdHeader).toContain("test-msg-1");
    expect(parsed.subject).toContain("Faktura");
    const pdf = parsed.attachments.find((a) => a.mimeType === "application/pdf");
    expect(pdf).toBeDefined();
    expect(pdf?.isInvoiceCandidate).toBe(true);
    expect(pdf?.content.length).toBeGreaterThan(10);
  });
});
