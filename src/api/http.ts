import { clearStoredToken } from '../auth/session'

function handleUnauthorized() {
  clearStoredToken()
  if (window.location.pathname !== '/login') {
    window.history.pushState(null, '', '/login')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

export async function readApiErrorMessage(res: Response): Promise<string> {
  if (res.status === 401) {
    handleUnauthorized()
    return 'Sesja wygasła — zaloguj się ponownie.'
  }
  if (res.status === 403) return 'Brak uprawnień do tej operacji.'
  try {
    const j = (await res.json()) as { error?: { message?: string } }
    if (typeof j.error?.message === 'string') return j.error.message
  } catch {
    // ignore and use fallback
  }
  return `HTTP ${res.status}`
}
