import JSZip from 'jszip'
import { fetchInvoiceAccountantPdfBlob } from '../api/invoicesApi'
import { getStoredToken } from '../auth/session'
import type { InvoiceRecord } from '../types/invoice'

function zipPdfFileName(index: number, row: InvoiceRecord): string {
  const label =
    (row.invoice_number || 'faktura')
      .replace(/[/\\:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'faktura'
  return `${String(index + 1).padStart(3, '0')}-${label}__${row.id.replace(/-/g, '').slice(0, 8)}.pdf`
}

/**
 * Paczka ZIP z plikami PDF dla księgowości.
 * — Gdy na liście coś jest zaznaczone: tylko zaznaczone wiersze (w ramach widocznej listy po filtrach).
 * — Gdy nic nie zaznaczono: wszystkie widoczne wiersze (ta sama lista co po filtrach dat itd.).
 * PDF: oryginalny plik PDF albo PDF z pelna struktura FA (parsowanie XML KSeF), skan JPG/PNG → PDF.
 */
export async function downloadInvoicePdfPackage(
  visibleRows: InvoiceRecord[],
  selectedIds: Set<string>,
): Promise<void> {
  const token = getStoredToken()
  if (!token) {
    window.alert('Brak sesji — zaloguj się ponownie.')
    return
  }
  const list =
    selectedIds.size > 0 ? visibleRows.filter((r) => selectedIds.has(r.id)) : visibleRows
  if (list.length === 0) {
    window.alert(
      'Brak faktur do spakowania. Ustaw filtry tak, by lista zawierała pozycje albo zaznacz faktury w tabeli.',
    )
    return
  }

  const zip = new JSZip()
  const f = zip.folder('faktury')
  if (!f) {
    throw new Error('Nie udało się utworzyć archiwum ZIP.')
  }

  const errors: string[] = []
  for (let i = 0; i < list.length; i++) {
    const row = list[i]!
    try {
      const blob = await fetchInvoiceAccountantPdfBlob(token, row.id)
      f.file(zipPdfFileName(i, row), blob)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${row.invoice_number || row.id}: ${msg}`)
    }
  }

  if (errors.length === list.length) {
    throw new Error(
      errors.length > 3 ? errors.slice(0, 3).join('\n') + '\n…' : errors.join('\n'),
    )
  }

  const exportedAt = new Date().toISOString()
  const rangeNote =
    selectedIds.size > 0
      ? `Zakres: tylko zaznaczone na liscie (${list.length} faktur).`
      : `Zakres: wszystkie widoczne po filtrach (${list.length} faktur).`

  zip.file(
    'FV-Control-paczka-README.txt',
    [
      'FV Control — paczka PDF (ksiegowosc)',
      `Eksport: ${exportedAt}`,
      rangeNote,
      'Kazdy plik w folderze faktury/ to PDF (oryginal lub rownowaznik z podgladu).',
      errors.length > 0
        ? `Uwaga: pominietych pozycji z powodu bledu: ${errors.length}.`
        : '',
      errors.length > 0 ? errors.join('\n') : '',
    ]
      .filter((line) => line.length > 0)
      .join('\n'),
  )

  const outBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const date = new Date().toISOString().slice(0, 10)
  const url = URL.createObjectURL(outBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `FVControl-paczka-PDF-${date}.zip`
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)

  if (errors.length > 0) {
    window.alert(
      `Dodano ${list.length - errors.length} z ${list.length} faktur (PDF). Czesc pominieta — szczegoly w README w ZIP i tu: ${errors
        .slice(0, 2)
        .join('; ')}${errors.length > 2 ? '…' : ''}`,
    )
  }
}
