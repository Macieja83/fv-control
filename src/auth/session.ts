export const SESSION_TOKEN_KEY = 'fv_resta_access_token'

/** Token sprzed wejścia w impersonację — przywracany przyciskiem „Wróć do panelu”. */
export const IMPERSONATION_RESTORE_TOKEN_KEY = 'fv_resta_impersonation_restore_token'

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setStoredToken(token: string) {
  sessionStorage.setItem(SESSION_TOKEN_KEY, token)
}

export function clearStoredToken() {
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
    sessionStorage.removeItem(IMPERSONATION_RESTORE_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}
