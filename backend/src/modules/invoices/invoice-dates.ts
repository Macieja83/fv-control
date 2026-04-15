export function parseInvoiceDate(input: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return new Date(`${input}T00:00:00.000Z`);
  }
  return new Date(input);
}

function isValidCalendarUtcYmd(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Normalizuje termin płatności z typowych formatów na fakturach PL (PDF/OCR) do `YYYY-MM-DD`.
 * Obsługuje: ISO na początku lub w tekście, DD.MM.RRRR, DD/MM/RRRR, DD-MM-RRRR (interpretacja DMY).
 */
export function normalizeDueDateStringToYmd(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;

  if (t.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(t)) {
    const ymd = t.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      const py = Number(ymd.slice(0, 4));
      const pm = Number(ymd.slice(5, 7));
      const pd = Number(ymd.slice(8, 10));
      if (isValidCalendarUtcYmd(py, pm, pd)) return ymd;
    }
  }

  const isoWord = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoWord) {
    const y = Number(isoWord[1]);
    const m = Number(isoWord[2]);
    const d = Number(isoWord[3]);
    if (isValidCalendarUtcYmd(y, m, d)) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  const dmy = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/);
  if (dmy) {
    const d = Number(dmy[1]);
    const mo = Number(dmy[2]);
    const y = Number(dmy[3]);
    if (isValidCalendarUtcYmd(y, mo, d)) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  return undefined;
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
