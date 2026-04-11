import { describe, expect, it } from "vitest";
import { tryExtractDraftFromKsefFaXml } from "./ksef-fa-xml-extract.js";

const SAMPLE_FA = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">
  <Fa>
    <P_1>2026-04-11</P_1>
    <P_2>FV/2026/TEST-004</P_2>
    <KodWaluty>PLN</KodWaluty>
    <P_13_1>437.25</P_13_1>
    <P_14_1>100.56</P_14_1>
    <P_15>537.81</P_15>
    <Podmiot1>
      <DaneIdentyfikacyjne>
        <NIP>5555555555</NIP>
        <Nazwa>DAKAR SP Z O.O.</Nazwa>
      </DaneIdentyfikacyjne>
    </Podmiot1>
  </Fa>
</Faktura>`;

describe("tryExtractDraftFromKsefFaXml", () => {
  it("parses FA totals and seller from KSeF-style XML", () => {
    const buf = Buffer.from(SAMPLE_FA, "utf8");
    const r = tryExtractDraftFromKsefFaXml(buf, "application/xml");
    expect(r).not.toBeNull();
    expect(r!.draft.number).toBe("FV/2026/TEST-004");
    expect(r!.draft.grossTotal).toBe("537.81");
    expect(r!.draft.contractorNip).toBe("5555555555");
    expect(r!.draft.contractorName).toContain("DAKAR");
    expect(r!.confidence).toBeGreaterThanOrEqual(0.99);
  });

  it("returns null for non-XML", () => {
    const r = tryExtractDraftFromKsefFaXml(Buffer.from("%PDF-1.4"), "application/pdf");
    expect(r).toBeNull();
  });
});
