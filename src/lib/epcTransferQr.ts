/**
 * EPC069-12 — QR do inicjacji przelewu SEPA (SCT). Wiele polskich aplikacji bankowych
 * rozpoznaje ten format po zeskanowaniu (przelew / płatności).
 * @see https://www.europeanpaymentscouncil.eu/document-library/guidance-documents/quick-response-code-guidelines-enable-data-capture-initiation
 */

const EPC_SUPPORTED_CURRENCIES = new Set(['PLN', 'EUR'])

/** ISO 7064 Mod 97-10 (walidacja IBAN). */
export function isValidIban(iban: string): boolean {
  const x = iban.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(x) || x.length < 15) return false
  const rearranged = x.slice(4) + x.slice(0, 4)
  let expanded = ''
  for (const ch of rearranged) {
    const c = ch.charCodeAt(0)
    if (c >= 48 && c <= 57) expanded += ch
    else if (c >= 65 && c <= 90) expanded += String(c - 55)
    else return false
  }
  let tmp = expanded
  while (tmp.length > 2) {
    const block = tmp.slice(0, Math.min(9, tmp.length))
    tmp = String(parseInt(block, 10) % 97) + tmp.slice(block.length)
  }
  return parseInt(tmp, 10) % 97 === 1
}

/**
 * Z surowego numeru (26-cyfrowy NRB, 24-cyfrowy BBAN lub pełny IBAN) buduje poprawny IBAN PL.
 * Próbuje wariantów zgodnych z typowym OCR faktur PL.
 */
export function normalizeAccountToIban(accountRaw: string): string | null {
  const compact = accountRaw.replace(/\s/g, '').toUpperCase()
  if (/^[A-Z]{2}\d{2}/.test(compact) && isValidIban(compact)) return compact

  const digits = accountRaw.replace(/\D/g, '')
  const tryBban = (bban: string): string | null => {
    if (bban.length < 12 || bban.length > 30) return null
    for (let k = 0; k < 100; k++) {
      const iban = `PL${String(k).padStart(2, '0')}${bban}`
      if (isValidIban(iban)) return iban
    }
    return null
  }

  if (digits.length === 26) {
    const a = tryBban(digits)
    if (a) return a
    const b = tryBban(digits.slice(2))
    if (b) return b
  }
  if (digits.length === 24) {
    const c = tryBban(digits)
    if (c) return c
  }
  return null
}

function formatEpcAmount(amountStr: string, currency: string): string | null {
  const cur = currency.trim().toUpperCase()
  if (!EPC_SUPPORTED_CURRENCIES.has(cur)) return null
  const n = Number.parseFloat(amountStr.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0.01) return null
  const fixed = n.toFixed(2)
  return `${cur}${fixed}`
}

function sanitizeEpcLine(s: string, maxLen: number): string {
  const t = s.replace(/\r|\n/g, ' ').trim()
  return t.length <= maxLen ? t : t.slice(0, maxLen)
}

export type EpcSctQrInput = {
  beneficiaryName: string
  accountRaw: string
  amount: string
  currency: string
  remittance: string
}

/**
 * Zwraca treść zakodowaną w QR (wiersze rozdzielone \n), albo null gdy brak IBAN / waluty.
 */
export function buildEpcSctQrPayload(input: EpcSctQrInput): string | null {
  const iban = normalizeAccountToIban(input.accountRaw)
  if (!iban) return null
  const amountField = formatEpcAmount(input.amount, input.currency)
  if (!amountField) return null

  const name = sanitizeEpcLine(input.beneficiaryName || 'Odbiorca', 70)
  const remittance = sanitizeEpcLine(input.remittance || '', 140)

  const lines = [
    'BCD',
    '002',
    '1',
    'SCT',
    '',
    name,
    iban,
    amountField,
    '',
    '',
    remittance,
  ]
  return lines.join('\n')
}
