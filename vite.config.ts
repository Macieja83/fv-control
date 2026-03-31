import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { authDevPlugin } from './vite/auth-middleware'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const loginPassword = env.FV_RESTA_LOGIN_PASSWORD ?? ''
  const loginEmail = env.FV_RESTA_LOGIN_EMAIL ?? ''

  return {
    plugins: [
      react(),
      authDevPlugin({
        loginPassword,
        loginEmail,
      }),
    ],
  }
})
