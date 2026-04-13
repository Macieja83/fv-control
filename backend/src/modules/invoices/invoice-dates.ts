export function parseInvoiceDate(input: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return new Date(`${input}T00:00:00.000Z`);
  }
  return new Date(input);
}

/**
 * Data wystawienia jako **dzień kalendarzowy** (prefiks `YYYY-MM-DD`).
 * Gdy źródło ma pełne ISO z offsetem (`…+02:00`), zwykły `new Date()` przesuwa dzień w UTC
 * i lista `GET /invoices?dateFrom=…` rozjeżdża się z portalem KSeF (Issue = data wystawienia).
 */
export function parseIssueDateCalendarYmd(raw: string | null | undefined, fallback: Date): Date {
  if (raw == null || typeof raw !== "string") return fallback;
  const t = raw.trim();
  if (t.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(t)) {
    const ymd = t.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return parseInvoiceDate(ymd);
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/**
 * Górny koniec **kalendarzowego** dnia `YYYY-MM-DD` w UTC (23:59:59.999Z).
 * Używaj dla `dateTo` w filtrach listy, żeby objąć wpisy z `issueDate` w ciągu tego dnia
 * (nie tylko dokładnie północ pierwszej chwili dnia).
 */
export function parseInvoiceDateInclusiveEndUtc(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return new Date(ymd);
  }
  const parts = ymd.split("-").map(Number);
  const y = parts[0]!;
  const mo = parts[1]!;
  const d = parts[2]!;
  return new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999));
}
