import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { authDevPlugin } from './vite/auth-middleware'
import { localBackendWarningPlugin } from './vite/local-backend-hint'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, process.cwd(), 'VITE_'),
    ...loadEnv(mode, process.cwd(), 'FV_RESTA_'),
  }
  const loginPassword = env.FV_RESTA_LOGIN_PASSWORD ?? ''
  const loginEmail = env.FV_RESTA_LOGIN_EMAIL ?? ''
  /** Pełny URL backendu (np. http://localhost:3000) — wtedy /api jest proxy i logowanie idzie do Fastify. */
  const apiUrl = (env.FV_RESTA_API_URL ?? '').trim().replace(/\/$/, '')

  return {
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    plugins: [
      react(),
      localBackendWarningPlugin(apiUrl),
      ...(apiUrl
        ? []
        : [
            authDevPlugin({
              loginPassword,
              loginEmail,
            }),
          ]),
    ],
    preview: {
      allowedHosts: true,
    },
    server: {
      proxy: apiUrl
        ? {
            '/api': {
              target: apiUrl,
              changeOrigin: true,
            },
          }
        : undefined,
    },
  }
})
