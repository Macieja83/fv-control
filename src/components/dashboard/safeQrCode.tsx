import type { ComponentType } from 'react'
import qrImport from 'react-qr-code'

type SafeQrProps = {
  value: string
  size?: number
  level?: 'L' | 'M' | 'Q' | 'H'
}

function resolveQrComponent(): ComponentType<SafeQrProps> | null {
  const x = qrImport as unknown
  if (typeof x === 'function') return x as ComponentType<SafeQrProps>
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>
    if (typeof o.default === 'function') return o.default as ComponentType<SafeQrProps>
    if (typeof o.QRCode === 'function') return o.QRCode as ComponentType<SafeQrProps>
  }
  return null
}

const QrResolved = resolveQrComponent()

/** Obejście CJS ↔ ESM: domyślny import bywa obiektem `{ default, QRCode }`, co w produkcji daje React #130. */
export function SafeQrCode(props: SafeQrProps) {
  if (!QrResolved) {
    return (
      <p className="workspace-panel__muted" role="status">
        Nie udało się załadować modułu kodu QR — użyj danych do przelewu powyżej.
      </p>
    )
  }
  return <QrResolved {...props} />
}
