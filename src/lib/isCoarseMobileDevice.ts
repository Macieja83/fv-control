/**
 * Heurystyka: telefon / tablet z aparatem — wtedy lepiej otworzyć natywny `<input capture>`.
 * Na typowym desktopie (duży ekran, brak touch) używamy QR → telefon.
 */
export function isCoarseMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(pointer: coarse)').matches) return true
  const small = window.matchMedia('(max-width: 768px)').matches
  const touch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0
  if (small && touch) return true
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true
  return false
}
