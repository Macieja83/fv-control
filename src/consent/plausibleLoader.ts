const SCRIPT_ID = 'fv-cc-plausible'

function defaultScriptSrc(): string {
  const fromEnv = import.meta.env.VITE_PLAUSIBLE_SCRIPT_SRC
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim()
  return 'https://plausible.io/js/script.js'
}

export function mountPlausible(domain: string): void {
  const src = defaultScriptSrc()
  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
  if (existing?.getAttribute('data-domain') === domain) {
    return
  }
  existing?.remove()

  const s = document.createElement('script')
  s.id = SCRIPT_ID
  s.defer = true
  s.setAttribute('data-domain', domain)
  s.src = src
  document.head.appendChild(s)
}

export function unmountPlausible(): void {
  document.getElementById(SCRIPT_ID)?.remove()
  if (typeof window !== 'undefined' && 'plausible' in window) {
    try {
      Reflect.deleteProperty(window, 'plausible')
    } catch {
      /* ignore */
    }
  }
}
