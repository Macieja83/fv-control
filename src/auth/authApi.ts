export type LoginSuccess = {
  accessToken: string
  expiresIn: number
  email: string
}

export type ApiError = { error: string }

export async function loginRequest(email: string, password: string): Promise<LoginSuccess> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = (await res.json()) as LoginSuccess & ApiError
  if (!res.ok) {
    throw new Error(data.error || `Błąd logowania (${res.status})`)
  }
  if (!data.accessToken) {
    throw new Error('Brak tokena w odpowiedzi serwera.')
  }
  return data as LoginSuccess
}

export async function sessionRequest(token: string): Promise<{ valid: boolean; email?: string }> {
  const res = await fetch('/api/auth/session', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = (await res.json()) as { valid: boolean; email?: string }
  if (!res.ok) return { valid: false }
  return data
}

export async function logoutRequest(token: string): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token }),
    })
  } catch {
    /* sieć — i tak czyścimy klienta */
  }
}
