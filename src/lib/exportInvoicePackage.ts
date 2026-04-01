import JSZip from 'jszip'
import type { InvoiceRecord } from '../types/invoice'

export type InvoicePackagePayload = {
  schemaVersion: 1
  exportedAt: string
  count: number
  invoices: InvoiceRecord[]
}

export function buildInvoicePackageJson(rows: InvoiceRecord[]): string {
  const payload: InvoicePackagePayload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    count: rows.length,
    invoices: rows,
  }
  return JSON.stringify(payload, null, 2)
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Archiwum ZIP z listą faktur (widocznej po filtrach):
 * - `invoices.json` — pełna paczka (manifest + wszystkie rekordy)
 * - `faktury/<id>.json` — pojedyncze faktury (łatwe do skryptów / przyszłych PDF obok)
 */
export async function downloadInvoicePackage(rows: InvoiceRecord[]): Promise<void> {
  if (rows.length === 0) return

  const zip = new JSZip()
  zip.file('invoices.json', buildInvoicePackageJson(rows))

  const perInvoice = zip.folder('faktury')
  if (perInvoice) {
    for (const inv of rows) {
      perInvoice.file(`${inv.id}.json`, JSON.stringify(inv, null, 2))
    }
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const date = new Date().toISOString().slice(0, 10)
  triggerBlobDownload(blob, `FVControl-paczka-faktur-${date}.zip`)
}
