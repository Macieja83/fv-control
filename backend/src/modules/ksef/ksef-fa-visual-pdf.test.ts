import { describe, expect, it } from "vitest";
import { buildKsefFaXmlVisualPdf } from "./ksef-fa-visual-pdf.js";

const WITH_LINES = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">
  <Fa>
    <P_1>2026-05-13</P_1>
    <P_2>F 12729/1307/26</P_2>
    <KodWaluty>PLN</KodWaluty>
    <P_13_1>92.63</P_13_1>
    <P_14_1>7.41</P_14_1>
    <P_15>100.04</P_15>
    <Podmiot1>
      <DaneIdentyfikacyjne>
        <NIP>7740001454</NIP>
        <Nazwa>ORLEN S.A.</Nazwa>
      </DaneIdentyfikacyjne>
    </Podmiot1>
    <Podmiot2>
      <DaneIdentyfikacyjne>
        <NIP>1234567890</NIP>
        <Nazwa>TT GRUPA TEST</Nazwa>
      </DaneIdentyfikacyjne>
    </Podmiot2>
    <FaWiersz>
      <P_7>Paliwo Pb95</P_7>
      <P_8B>40.12</P_8B>
      <P_8A>l</P_8A>
      <P_9A>2.31</P_9A>
      <P_11>92.63</P_11>
      <P_12>8</P_12>
    </FaWiersz>
  </Fa>
</Faktura>`;

describe("buildKsefFaXmlVisualPdf", () => {
  it("returns non-empty PDF bytes for valid FA XML", async () => {
    const buf = Buffer.from(WITH_LINES, "utf8");
    const out = await buildKsefFaXmlVisualPdf({
      xmlBuffer: buf,
      mimeType: "application/xml",
      ksefNumber: "7740001454-20260513-78824280000E-67",
    });
    expect(out).not.toBeNull();
    expect(out!.length).toBeGreaterThan(500);
    expect(Buffer.from(out!).subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("returns null for invalid XML", async () => {
    const out = await buildKsefFaXmlVisualPdf({
      xmlBuffer: Buffer.from("<x/>", "utf8"),
      mimeType: "application/xml",
      ksefNumber: "x",
    });
    expect(out).toBeNull();
  });
});
