export type ExtractedInvoiceDraft = {
  number?: string;
  issueDate?: string;
  /** Termin płatności (YYYY-MM-DD) z sekcji Płatność / FA XML */
  dueDate?: string;
  currency?: string;
  netTotal?: string;
  vatTotal?: string;
  grossTotal?: string;
  /** Nazwa sprzedawcy (Sprzedawca) — nie Nabywca */
  contractorName?: string | null;
  contractorNip?: string | null;
  /** Nabywca z Podmiot2 (FA XML) — do wizualizacji PDF */
  buyerName?: string | null;
  buyerNip?: string | null;
  /** Kod FormaPlatnosci z FA (np. "6") — opcjonalnie */
  paymentFormCode?: string | null;
  /** Czytelna forma płatności (np. „Przelew”) */
  paymentForm?: string | null;
  /** Nr rachunku (NrRB) bez spacji */
  bankAccount?: string | null;
  bankName?: string | null;
  swift?: string | null;
  /** Opis rachunku / innej płatności z FA */
  paymentDescription?: string | null;
  lineItems?: Array<{
    name: string;
    quantity: string;
    /** Jednostka miary (np. l, kWh) z P_8A FA */
    unit?: string;
    netPrice: string;
    vatRate: string;
    netValue: string;
    grossValue: string;
  }>;
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
