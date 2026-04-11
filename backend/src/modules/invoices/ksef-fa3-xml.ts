import { createHash } from "node:crypto";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type Fa3LineInput = {
  name: string;
  quantity: string;
  unit: string | null;
  netPrice: string;
  vatRate: string;
  netValue: string;
  grossValue: string;
};

/**
 * Uproszczony XML FA(3) do próby wysyłki w KSeF (środowisko testowe / produkcja).
 * Pełna zgodność z XSD MF wymaga rozszerzenia pól (adresy, GTU, płatność itd.).
 */
export function buildFa3InvoiceXml(input: {
  sellerName: string;
  sellerNip: string;
  buyerName: string;
  buyerNip: string;
  invoiceNumber: string;
  issueDateYmd: string;
  currency: string;
  lines: Fa3LineInput[];
  netTotal: string;
  vatTotal: string;
  grossTotal: string;
}): string {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const wiersze = input.lines
    .map(
      (l, i) => `    <FaWiersz>
      <NrWierszaFa>${i + 1}</NrWierszaFa>
      <P_7>${esc(l.name)}</P_7>
      <P_8A>${esc(l.unit ?? "szt.")}</P_8A>
      <P_8B>${esc(l.quantity)}</P_8B>
      <P_9A>${esc(l.netPrice)}</P_9A>
      <P_11>${esc(l.netValue)}</P_11>
      <P_12>${esc(l.vatRate)}</P_12>
      <P_11A>${esc(l.grossValue)}</P_11A>
    </FaWiersz>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">
  <Naglowek>
    <KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>3</WariantFormularza>
    <DataWytworzeniaFa>${esc(now)}</DataWytworzeniaFa>
    <SystemInfo>FV Control</SystemInfo>
  </Naglowek>
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>${esc(input.sellerNip)}</NIP>
      <Nazwa>${esc(input.sellerName)}</Nazwa>
    </DaneIdentyfikacyjne>
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne>
      <NIP>${esc(input.buyerNip)}</NIP>
      <Nazwa>${esc(input.buyerName)}</Nazwa>
    </DaneIdentyfikacyjne>
  </Podmiot2>
  <Fa>
    <KodWaluty>${esc(input.currency)}</KodWaluty>
    <P_1>${esc(input.issueDateYmd)}</P_1>
    <P_1M>${esc(input.invoiceNumber)}</P_1M>
    <P_13_1>${esc(input.netTotal)}</P_13_1>
    <P_14_1>${esc(input.vatTotal)}</P_14_1>
    <P_15>${esc(input.grossTotal)}</P_15>
    <FaWiersze>
${wiersze}
    </FaWiersze>
  </Fa>
</Faktura>`;
}

export function sha256HexUtf8(xml: string): string {
  return createHash("sha256").update(xml, "utf-8").digest("hex");
}
