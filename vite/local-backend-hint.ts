import http from 'node:http'
import type { Plugin } from 'vite'

/** Przy starcie Vite: jeśli FV_RESTA_API_URL wskazuje lokalne API, a nic nie odpowiada — log z podpowiedzią (unikniesz 502 w loginie). */
export function localBackendWarningPlugin(apiUrl: string | undefined): Plugin {
  if (!apiUrl) {
    return { name: 'local-backend-hint' }
  }
  return {
    name: 'local-backend-hint',
    apply: 'serve',
    configureServer(server) {
      const warn = () => {
        server.config.logger.warn(
          `[fv-control] FV_RESTA_API_URL=${apiUrl} — brak odpowiedzi (logowanie → 502). Uruchom: npm run dev:stack (Docker) lub npm run dev:web`,
        )
      }
      const tryOnce = () => {
        const url = `${apiUrl.replace(/\/$/, '')}/api/v1/ready`
        const req = http.get(url, (res) => {
          res.resume()
        })
        req.setTimeout(2000, () => {
          req.destroy()
          warn()
        })
        req.on('error', warn)
      }
      server.httpServer?.once('listening', tryOnce)
    },
  }
}
