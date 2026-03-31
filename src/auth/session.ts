export const SESSION_TOKEN_KEY = 'fv_resta_access_token'

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
  sessionStorage.removeItem(SESSION_TOKEN_KEY)
}
