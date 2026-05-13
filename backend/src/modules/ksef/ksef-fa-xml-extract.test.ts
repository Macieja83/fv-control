import { describe, expect, it } from "vitest";
import {
  tryExtractDraftFromKsefFaXml,
  tryExtractPaymentFieldsFromKsefFaXml,
} from "./ksef-fa-xml-extract.js";

const SAMPLE_FA = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">
  <Fa>
    <P_1>2026-04-11</P_1>
    <P_2>FV/2026/TEST-004</P_2>
    <KodWaluty>PLN</KodWaluty>
    <P_13_1>437.25</P_13_1>
    <P_14_1>100.56</P_14_1>
    <P_15>537.81</P_15>
    <Platnosc>
      <FormaPlatnosci>6</FormaPlatnosci>
      <TerminPlatnosci><Termin>2026-05-20</Termin></TerminPlatnosci>
      <RachunekBankowy>
        <NrRB>12 3456 7890 1234 5678 9012 3456</NrRB>
        <NazwaBanku>Test Bank</NazwaBanku>
        <SWIFT>TESTPLPW</SWIFT>
      </RachunekBankowy>
      <OpisRachunku>fv/2026/test</OpisRachunku>
    </Platnosc>
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
    expect(r!.draft.dueDate).toBe("2026-05-20");
    expect(r!.draft.paymentForm).toBe("Przelew");
    expect(r!.draft.paymentFormCode).toBe("6");
    expect(r!.draft.bankAccount).toBe("12345678901234567890123456");
    expect(r!.draft.bankName).toBe("Test Bank");
    expect(r!.draft.swift).toBe("TESTPLPW");
    expect(r!.draft.paymentDescription).toBe("fv/2026/test");
  });

  it("parses nabywca from Podmiot2", () => {
    const xml = SAMPLE_FA.replace(
      "</Podmiot1>",
      `</Podmiot1>
    <Podmiot2>
      <DaneIdentyfikacyjne>
        <NIP>9988776655</NIP>
        <Nazwa>NABYWCA TEST SP Z O O</Nazwa>
      </DaneIdentyfikacyjne>
    </Podmiot2>`,
    );
    const r = tryExtractDraftFromKsefFaXml(Buffer.from(xml, "utf8"), "application/xml");
    expect(r).not.toBeNull();
    expect(r!.draft.buyerNip).toBe("9988776655");
    expect(r!.draft.buyerName).toContain("NABYWCA");
  });

  it("returns null for non-XML", () => {
    const r = tryExtractDraftFromKsefFaXml(Buffer.from("%PDF-1.4"), "application/pdf");
    expect(r).toBeNull();
  });

  it("uses P_1 as issue date only, not P_6 (sale/service date)", () => {
    const xml = SAMPLE_FA.replace(
      "<P_1>2026-04-11</P_1>",
      "<P_1>2026-04-11</P_1>\n    <P_6>2026-04-10</P_6>",
    );
    const r = tryExtractDraftFromKsefFaXml(Buffer.from(xml, "utf8"), "application/xml");
    expect(r).not.toBeNull();
    expect(r!.draft.issueDate).toBe("2026-04-11");
  });

  it("reads Podmiot1 from Faktura when not nested inside Fa (FA(3)-style layout)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>1234567890</NIP>
      <Nazwa>SPRZEDAWCA SP Z O O</Nazwa>
    </DaneIdentyfikacyjne>
  </Podmiot1>
  <Fa>
    <P_1>2026-04-01</P_1>
    <P_2>FV/FA3/001</P_2>
    <KodWaluty>PLN</KodWaluty>
    <P_13_1>50.00</P_13_1>
    <P_14_1>11.50</P_14_1>
    <P_15>61.50</P_15>
  </Fa>
</Faktura>`;
    const r = tryExtractDraftFromKsefFaXml(Buffer.from(xml, "utf8"), "application/xml");
    expect(r).not.toBeNull();
    expect(r!.draft.number).toBe("FV/FA3/001");
    expect(r!.draft.contractorNip).toBe("1234567890");
    expect(r!.draft.contractorName).toContain("SPRZEDAWCA");
    expect(r!.draft.grossTotal).toBe("61.50");
  });

  it("tryExtractPaymentFieldsFromKsefFaXml reads Platnosc even when P_2 is missing", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">
  <Fa>
    <Platnosc>
      <FormaPlatnosci>6</FormaPlatnosci>
      <TerminPlatnosci><Termin>2026-06-01</Termin></TerminPlatnosci>
      <RachunekBankowy><NrRB>11112222333344445555666666</NrRB></RachunekBankowy>
    </Platnosc>
  </Fa>
</Faktura>`;
    expect(tryExtractDraftFromKsefFaXml(Buffer.from(xml, "utf8"), "application/xml")).toBeNull();
    const pay = tryExtractPaymentFieldsFromKsefFaXml(Buffer.from(xml, "utf8"), "application/xml");
    expect(pay).not.toBeNull();
    expect(pay!.dueDate).toBe("2026-06-01");
    expect(pay!.bankAccount).toBe("11112222333344445555666666");
    expect(pay!.paymentForm).toBe("Przelew");
  });
});
