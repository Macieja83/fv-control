type SessionImpersonation = {
  active: true
  effectiveTenantId: string
  effectiveTenantName: string | null
  effectiveTenantNip?: string | null
} | null

function readIsPlatformAdmin(u: { isPlatformAdmin?: boolean; isSuperAdmin?: boolean } | undefined): boolean {
  if (!u) return false
  if (u.isPlatformAdmin === true) return true
  return u.isSuperAdmin === true
}

export type LoginSuccess = {
  accessToken: string
  expiresIn: number
  user: {
    email: string
    tenantId: string
    emailVerified: boolean
    isPlatformAdmin: boolean
  }
}

type BackendLoginUser = {
  email?: string
  tenantId?: string
  emailVerified?: boolean
  isSuperAdmin?: boolean
}

type BackendLoginBody = {
  accessToken?: string
  expiresIn?: number
  user?: BackendLoginUser
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
  const resolvedEmail = typeof data.user?.email === 'string' ? data.user.email : email
  return {
    accessToken,
    expiresIn,
    user: {
      email: resolvedEmail,
      tenantId: typeof data.user?.tenantId === 'string' ? data.user.tenantId : '',
      emailVerified: data.user?.emailVerified === true,
      isPlatformAdmin: readIsPlatformAdmin(data.user),
    },
  }
}

export async function sessionRequest(token: string): Promise<{
  valid: boolean
  user?: {
    email: string
    tenantId: string
    emailVerified: boolean
    isPlatformAdmin: boolean
    tenantName?: string | null
    impersonation?: SessionImpersonation
  }
}> {
  const res = await fetch('/api/v1/auth/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return { valid: false }
  const data = (await res.json()) as {
    email?: string
    tenantId?: string
    emailVerified?: boolean
    isPlatformAdmin?: boolean
    isSuperAdmin?: boolean
    tenantName?: string | null
    impersonation?: SessionImpersonation
  }
  if (typeof data.email === 'string') {
    const imp = data.impersonation
    const impersonation =
      imp && typeof imp === 'object' && imp.active === true
        ? {
            active: true as const,
            effectiveTenantId:
              typeof imp.effectiveTenantId === 'string' ? imp.effectiveTenantId : (typeof data.tenantId === 'string' ? data.tenantId : ''),
            effectiveTenantName: typeof imp.effectiveTenantName === 'string' || imp.effectiveTenantName === null ? imp.effectiveTenantName : null,
            effectiveTenantNip:
              typeof imp.effectiveTenantNip === 'string' || imp.effectiveTenantNip === null ? imp.effectiveTenantNip : undefined,
          }
        : null
    return {
      valid: true,
      user: {
        email: data.email,
        tenantId: typeof data.tenantId === 'string' ? data.tenantId : '',
        emailVerified: data.emailVerified === true,
        isPlatformAdmin: readIsPlatformAdmin(data),
        tenantName: typeof data.tenantName === 'string' || data.tenantName === null ? data.tenantName : undefined,
        impersonation,
      },
    }
  }
  return { valid: false }
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

export async function registerRequest(input: {
  tenantName: string
  tenantNip?: string | null
  email: string
  password: string
  planCode: 'free' | 'pro'
}): Promise<{ needsEmailVerification: boolean; verificationToken?: string }> {
  const res = await fetch('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = (await res.json()) as { needsEmailVerification?: boolean; verificationToken?: string; error?: { message?: string } }
  if (!res.ok) throw new Error(body.error?.message ?? `Rejestracja nieudana (${res.status})`)
  return {
    needsEmailVerification: body.needsEmailVerification === true,
    verificationToken: typeof body.verificationToken === 'string' ? body.verificationToken : undefined,
  }
}

export async function verifyEmailRequest(token: string): Promise<LoginSuccess> {
  const res = await fetch('/api/v1/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  const body = (await res.json()) as BackendLoginBody & BackendErrorBody
  if (!res.ok) throw new Error(readLoginErrorMessage(body, res.status))
  const accessToken = body.accessToken
  if (!accessToken || !body.user?.email) throw new Error('Brak poprawnej odpowiedzi weryfikacji.')
  return {
    accessToken,
    expiresIn: typeof body.expiresIn === 'number' ? body.expiresIn : 0,
    user: {
      email: body.user.email,
      tenantId: typeof body.user.tenantId === 'string' ? body.user.tenantId : '',
      emailVerified: body.user.emailVerified === true,
      isPlatformAdmin: readIsPlatformAdmin(body.user),
    },
  }
}

export async function resendVerificationRequest(email: string): Promise<{ verificationToken?: string }> {
  const res = await fetch('/api/v1/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const body = (await res.json()) as { verificationToken?: string; error?: { message?: string } }
  if (!res.ok) throw new Error(body.error?.message ?? `Nie udało się wysłać ponownie (${res.status})`)
  return { verificationToken: typeof body.verificationToken === 'string' ? body.verificationToken : undefined }
}

export async function getGoogleStartUrl(mode: 'login' | 'register'): Promise<string> {
  const res = await fetch(`/api/v1/auth/google/start?mode=${encodeURIComponent(mode)}`)
  const body = (await res.json()) as { url?: string; error?: { message?: string } }
  if (!res.ok || !body.url) throw new Error(body.error?.message ?? 'Google OAuth niedostępny')
  return body.url
}
