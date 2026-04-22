/**
 * Odtwarza właściwą orientację zdjęcia (EXIF) w bitmapie — pdf-lib wstawia surowe JPEG/PNG
 * i ignoruje Orientation, stąd portret „leży” na boku. Wynik: JPEG (łatwy `embedJpg` w PDF).
 */
export async function fileToUprightJpegBlob(file: File): Promise<Blob> {
  return toUprightJpegWithBitmap(file)
}

async function toUprightJpegWithBitmap(file: File): Promise<Blob> {
  const opts = { imageOrientation: 'from-image' } as ImageBitmapOptions
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, opts)
  } catch {
    try {
      bitmap = await createImageBitmap(file)
    } catch (e) {
      throw e instanceof Error
        ? e
        : new Error('Nie udało się odczytać zdjęcia (niewspierany typ — spróbuj JPEG/PNG albo mniej HEIC w ustawieniach aparatu).')
    }
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Brak kontekstu canvas')
    ctx.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92))
    if (!blob) throw new Error('Eksport obrazu nie powiódł się')
    return blob
  } finally {
    bitmap.close()
  }
}
