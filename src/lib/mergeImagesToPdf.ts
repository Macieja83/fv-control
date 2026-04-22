import { PDFDocument } from 'pdf-lib'

const A4_W = 595.28
const A4_H = 841.89

/**
 * Łączy strony (JPEG/PNG) w jeden wielostronicowy PDF do jednego zadania OCR.
 */
export async function mergeImageFilesToPdfBlob(files: File[]): Promise<Blob> {
  if (files.length === 0) throw new Error('Brak plików')
  if (files.length === 1) {
    const f = files[0]!
    if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
      return f
    }
  }

  const pdf = await PDFDocument.create()
  for (const file of files) {
    const buf = new Uint8Array(await file.arrayBuffer())
    const lower = file.name.toLowerCase()
    const isPng = file.type.includes('png') || lower.endsWith('.png')
    const image = isPng ? await pdf.embedPng(buf) : await pdf.embedJpg(buf)
    const iw = image.width
    const ih = image.height
    const page = pdf.addPage([A4_W, A4_H])
    const scale = Math.min((A4_W - 40) / iw, (A4_H - 40) / ih)
    const dw = iw * scale
    const dh = ih * scale
    const x = (A4_W - dw) / 2
    const y = (A4_H - dh) / 2
    page.drawImage(image, { x, y, width: dw, height: dh })
  }
  const out = await pdf.save()
  return new Blob([new Uint8Array(out)], { type: 'application/pdf' })
}
