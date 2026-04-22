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
    /** false tylko dla kont wyłącznie Google (do ustawienia hasła w Ustawieniach). */
    hasPassword: boolean
  }
}

type BackendLoginUser = {
  email?: string
  tenantId?: string
  emailVerified?: boolean
  isSuperAdmin?: boolean
  hasPassword?: boolean
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
      'Brak połączenia z API (czy coś nasłuchuje na porcie z FV_RESTA_API_URL?). Pełny stos: uruchom Docker Desktop, potem z katalogu głównego `npm run dev:stack` (albo `infra:up` + w backend: migrate/seed + `dev:all`). Szybki front bez bazy: `npm run dev:web`.',
    )
  }
  const rawText = await res.text()
  let data: BackendLoginBody & BackendErrorBody
  try {
    data = rawText ? (JSON.parse(rawText) as BackendLoginBody & BackendErrorBody) : {}
  } catch {
    throw new Error(
      res.status === 502 || res.status === 504
        ? 'Proxy Vite nie łączy się z API (zwykle nic nie nasłuchuje na localhost:3000). Uruchom stack albo tymczasowo: npm run dev:web.'
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
  const hasPassword =
    typeof data.user?.hasPassword === 'boolean' ? data.user.hasPassword : true
  return {
    accessToken,
    expiresIn,
    user: {
      email: resolvedEmail,
      tenantId: typeof data.user?.tenantId === 'string' ? data.user.tenantId : '',
      emailVerified: data.user?.emailVerified === true,
      isPlatformAdmin: readIsPlatformAdmin(data.user),
      hasPassword,
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
    hasPassword: boolean
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
    hasPassword?: boolean
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
    const hasPassword = typeof data.hasPassword === 'boolean' ? data.hasPassword : true
    return {
      valid: true,
      user: {
        email: data.email,
        tenantId: typeof data.tenantId === 'string' ? data.tenantId : '',
        emailVerified: data.emailVerified === true,
        isPlatformAdmin: readIsPlatformAdmin(data),
        hasPassword,
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

export async function forgotPasswordRequest(email: string): Promise<{ sent: true; resetToken?: string }> {
  const res = await fetch('/api/v1/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const body = (await res.json()) as { sent?: boolean; resetToken?: string; error?: { message?: string } }
  if (!res.ok) throw new Error(body.error?.message ?? `Nie udało się wysłać (${res.status})`)
  return { sent: true, resetToken: typeof body.resetToken === 'string' ? body.resetToken : undefined }
}

export async function resetPasswordRequest(token: string, password: string): Promise<LoginSuccess> {
  const res = await fetch('/api/v1/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  })
  const body = (await res.json()) as BackendLoginBody & BackendErrorBody
  if (!res.ok) throw new Error(readLoginErrorMessage(body, res.status))
  const accessToken = body.accessToken
  if (!accessToken || !body.user?.email) throw new Error('Brak poprawnej odpowiedzi resetu hasła.')
  const hasPassword =
    typeof body.user.hasPassword === 'boolean' ? body.user.hasPassword : true
  return {
    accessToken,
    expiresIn: typeof body.expiresIn === 'number' ? body.expiresIn : 0,
    user: {
      email: body.user.email,
      tenantId: typeof body.user.tenantId === 'string' ? body.user.tenantId : '',
      emailVerified: body.user.emailVerified === true,
      isPlatformAdmin: readIsPlatformAdmin(body.user),
      hasPassword,
    },
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
  const hasPassword =
    typeof body.user.hasPassword === 'boolean' ? body.user.hasPassword : true
  return {
    accessToken,
    expiresIn: typeof body.expiresIn === 'number' ? body.expiresIn : 0,
    user: {
      email: body.user.email,
      tenantId: typeof body.user.tenantId === 'string' ? body.user.tenantId : '',
      emailVerified: body.user.emailVerified === true,
      isPlatformAdmin: readIsPlatformAdmin(body.user),
      hasPassword,
    },
  }
}

export async function setInitialPasswordRequest(token: string, password: string): Promise<void> {
  const res = await fetch('/api/v1/auth/set-initial-password', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  })
  if (res.ok || res.status === 204) return
  const raw = await res.text()
  let msg = `Nie udało się zapisać hasła (${res.status})`
  try {
    const j = raw ? (JSON.parse(raw) as BackendErrorBody) : {}
    msg = readLoginErrorMessage(j, res.status)
  } catch {
    /* ignore */
  }
  throw new Error(msg)
}

export async function changePasswordRequest(
  token: string,
  currentPassword: string,
  password: string,
): Promise<void> {
  const res = await fetch('/api/v1/auth/change-password', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ currentPassword, password }),
  })
  if (res.ok || res.status === 204) return
  const raw = await res.text()
  let msg = `Zmiana hasła nieudana (${res.status})`
  try {
    const j = raw ? (JSON.parse(raw) as BackendErrorBody) : {}
    msg = readLoginErrorMessage(j, res.status)
  } catch {
    /* ignore */
  }
  throw new Error(msg)
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
  let body: BackendErrorBody & { url?: string } = {}
  try {
    body = (await res.json()) as BackendErrorBody & { url?: string }
  } catch {
    /* ignore */
  }
  if (!res.ok || !body.url) throw new Error(readLoginErrorMessage(body, res.status))
  return body.url
}
