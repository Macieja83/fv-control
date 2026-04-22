import type { Connect } from 'vite'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const SESSION_MS = 8 * 60 * 60 * 1000

function readBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > maxBytes) {
        reject(new Error('Payload too large'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function hashUtf8(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest()
}

function safeEqualPassword(input: string, expected: string): boolean {
  const a = hashUtf8(input)
  const b = hashUtf8(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

type AuthOptions = {
  loginPassword: string
  /** Jeśli ustawione (np. manager@resta.biz), login wymaga tego samego adresu (case-insensitive). */
  loginEmail: string
}

function attachAuthMiddleware(
  middlewares: Connect.Server,
  sessions: Map<string, { email: string; exp: number }>,
  opts: AuthOptions,
) {
  middlewares.use(async (req, res, next) => {
    const url = (req.url ?? '').split('?')[0]
    const normUrl = url.replace('/api/v1/', '/api/')

    if ((normUrl === '/api/auth/login') && req.method === 'POST') {
      try {
        if (!opts.loginPassword) {
          sendJson(res, 503, {
            error:
              'Logowanie nie jest skonfigurowane. Ustaw FV_RESTA_LOGIN_PASSWORD w pliku .env (serwer Vite).',
          })
          return
        }

        const raw = await readBody(req as IncomingMessage)
        const body = JSON.parse(raw || '{}') as { email?: string; password?: string }
        const email = String(body.email ?? '').trim().toLowerCase()
        const password = String(body.password ?? '')

        if (!email || !password) {
          sendJson(res, 400, { error: 'Podaj e-mail i hasło.' })
          return
        }

        if (opts.loginEmail && email !== opts.loginEmail.toLowerCase()) {
          sendJson(res, 401, { error: 'Nieprawidłowy e-mail lub hasło.' })
          return
        }

        if (!safeEqualPassword(password, opts.loginPassword)) {
          sendJson(res, 401, { error: 'Nieprawidłowy e-mail lub hasło.' })
          return
        }

        const token = randomBytes(32).toString('hex')
        sessions.set(token, { email, exp: Date.now() + SESSION_MS })
        /** Kształt jak POST /api/v1/auth/login (Fastify) — wymagany przez src/auth/authApi.ts. */
        const devTenantId = '00000000-0000-4000-8000-000000000001'
        sendJson(res, 200, {
          accessToken: token,
          expiresIn: Math.floor(SESSION_MS / 1000),
          refreshToken: `dev-refresh-${token.slice(0, 16)}`,
          user: {
            email,
            tenantId: devTenantId,
            emailVerified: true,
            isPlatformAdmin: false,
            hasPassword: true,
            role: 'OWNER',
            id: '00000000-0000-4000-8000-000000000002',
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        })
      } catch {
        sendJson(res, 400, { error: 'Niepoprawne żądanie.' })
      }
      return
    }

    if (normUrl === '/api/auth/logout' && req.method === 'POST') {
      try {
        const raw = await readBody(req as IncomingMessage)
        const body = JSON.parse(raw || '{}') as { accessToken?: string }
        const auth = req.headers.authorization
        const token =
          typeof body.accessToken === 'string'
            ? body.accessToken
            : auth?.startsWith('Bearer ')
              ? auth.slice(7)
              : ''
        if (token) sessions.delete(token)
      } catch {
        /* ignore */
      }
      sendJson(res, 200, { ok: true })
      return
    }

    if ((normUrl === '/api/auth/session' || normUrl === '/api/auth/me') && req.method === 'GET') {
      const auth = req.headers.authorization
      const token = auth?.startsWith('Bearer ') ? auth.slice(7) : ''
      if (!token) {
        sendJson(res, 401, {
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized', details: null },
        })
        return
      }
      const s = sessions.get(token)
      if (!s || Date.now() > s.exp) {
        if (token) sessions.delete(token)
        sendJson(res, 401, {
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized', details: null },
        })
        return
      }
      const devTenantId = '00000000-0000-4000-8000-000000000001'
      const now = new Date().toISOString()
      /**
       * Musi odpowiadać kształtowi GET /api/v1/auth/me (authService.getMe) — inaczej
       * `sessionRequest` traci tenantId po odświeżeniu (poprzednio zwracaliśmy tylko { valid, email }).
       */
      sendJson(res, 200, {
        id: '00000000-0000-4000-8000-000000000002',
        tenantId: devTenantId,
        email: s.email,
        role: 'OWNER',
        emailVerified: true,
        isActive: true,
        isPlatformAdmin: false,
        isSuperAdmin: false,
        hasPassword: true,
        tenantName: 'Resta Demo',
        impersonation: null,
        createdAt: now,
        updatedAt: now,
      })
      return
    }

    next()
  })
}

export function authDevPlugin(opts: AuthOptions): Plugin {
  const sessions = new Map<string, { email: string; exp: number }>()

  return {
    name: 'fv-resta-auth-dev',
    configureServer(server) {
      attachAuthMiddleware(server.middlewares, sessions, opts)
    },
    configurePreviewServer(server) {
      attachAuthMiddleware(server.middlewares, sessions, opts)
    },
  }
}
