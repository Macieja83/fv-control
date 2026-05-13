import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './auth/AuthContext'
import { initCookieConsent } from './consent/initCookieConsent'
import './index.css'
import App from './App.tsx'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Missing #root element')
}

void initCookieConsent()
  .catch((err) => {
    console.error('[cookie-consent]', err)
  })
  .finally(() => {
    createRoot(rootEl).render(
      <StrictMode>
        <AuthProvider>
          <App />
        </AuthProvider>
      </StrictMode>,
    )
  })
