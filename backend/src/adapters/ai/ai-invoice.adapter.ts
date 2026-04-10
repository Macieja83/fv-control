export type ExtractedInvoiceDraft = {
  number?: string;
  issueDate?: string;
  saleDate?: string;
  dueDate?: string;
  currency?: string;
  netTotal?: string;
  vatTotal?: string;
  grossTotal?: string;
  /** Nazwa sprzedawcy (Sprzedawca) — nie Nabywca */
  contractorName?: string | null;
  contractorNip?: string | null;
  lineItems?: Array<{
    name: string;
    quantity: string;
    netPrice: string;
    vatRate: string;
    netValue: string;
    grossValue: string;
  }>;
  /** Extra fields from KSeF XML (seller/buyer addresses, payment info). */
  ksefMeta?: {
    sellerAddress?: string;
    buyerNip?: string;
    buyerName?: string;
    buyerAddress?: string;
    paymentForm?: string;
    bankAccount?: string;
  };
};

export type AiInvoiceAdapter = {
  extractInvoiceData(documentMeta: {
    mimeType: string;
    sha256: string;
    storageKey: string;
    buffer?: Buffer;
  }): Promise<{ draft: ExtractedInvoiceDraft; confidence: number }>;
  classifyInvoice(invoiceSnapshot: Record<string, unknown>): Promise<{ label: string; confidence: number }>;
  anomalyCheck(
    invoiceSnapshot: Record<string, unknown>,
    history: Record<string, unknown>[],
  ): Promise<{ score: number; flags: string[] }>;
};

export function createMockAiAdapter(featureMockEnabled: boolean): AiInvoiceAdapter {
  return {
    async extractInvoiceData(meta) {
      if (!featureMockEnabled) {
        return {
          draft: {},
          confidence: 0,
        };
      }
      return {
        draft: {
          number: `MOCK/${meta.sha256.slice(0, 6).toUpperCase()}`,
          issueDate: new Date().toISOString().slice(0, 10),
          currency: "PLN",
          netTotal: "100.00",
          vatTotal: "23.00",
          grossTotal: "123.00",
          contractorNip: "1111111111",
          contractorName: "Mock Sp. z o.o.",
          lineItems: [
            {
              name: "Mock line",
              quantity: "1",
              netPrice: "100.00",
              vatRate: "23.00",
              netValue: "100.00",
              grossValue: "123.00",
            },
          ],
        },
        confidence: 0.72,
      };
    },
    async classifyInvoice() {
      return { label: "PURCHASE", confidence: 0.61 };
    },
    async anomalyCheck() {
      return { score: 0.12, flags: [] };
    },
  };
}
