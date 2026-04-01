export type LoginSuccess = {
  accessToken: string
  expiresIn: number
  email: string
}

type BackendLoginUser = { email?: string }

type BackendLoginBody = {
  accessToken?: string
  expiresIn?: number
  user?: BackendLoginUser
  email?: string
}

type BackendErrorBody = {
  error?: string | { message?: string; code?: string }
}

function readLoginErrorMessage(data: BackendErrorBody, status: number): string {
  const e = data.error
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && typeof e.message === 'string') return e.message
  return `Błąd logowania (${status})`
}

export async function loginRequest(email: string, password: string): Promise<LoginSuccess> {
  let res: Response
  try {
    res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  } catch {
    throw new Error(
      'Brak połączenia z API. Uruchom backend (npm run dev w folderze backend) i sprawdź, czy Vite ma FV_RESTA_API_URL w .env.',
    )
  }
  const rawText = await res.text()
  let data: BackendLoginBody & BackendErrorBody
  try {
    data = rawText ? (JSON.parse(rawText) as BackendLoginBody & BackendErrorBody) : {}
  } catch {
    throw new Error(
      res.status === 502 || res.status === 504
        ? 'Proxy nie może połączyć się z backendem (port 3000?).'
        : `Niepoprawna odpowiedź serwera (${res.status}).`,
    )
  }
  if (!res.ok) {
    throw new Error(readLoginErrorMessage(data, res.status))
  }
  const accessToken = data.accessToken
  if (!accessToken) {
    throw new Error('Brak tokena w odpowiedzi serwera.')
  }
  const expiresIn = typeof data.expiresIn === 'number' ? data.expiresIn : 0
  const resolvedEmail =
    typeof data.user?.email === 'string'
      ? data.user.email
      : typeof data.email === 'string'
        ? data.email
        : email
  return { accessToken, expiresIn, email: resolvedEmail }
}

export async function sessionRequest(token: string): Promise<{ valid: boolean; email?: string }> {
  let res = await fetch('/api/v1/auth/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.ok) {
    const data = (await res.json()) as { email?: string }
    if (typeof data.email === 'string') {
      return { valid: true, email: data.email }
    }
    return { valid: false }
  }
  res = await fetch('/api/v1/auth/session', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const legacy = (await res.json()) as { valid: boolean; email?: string }
  if (!res.ok) return { valid: false }
  return legacy
}

export async function logoutRequest(token: string): Promise<void> {
  try {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    })
  } catch {
    /* sieć — i tak czyścimy klienta */
  }
}
