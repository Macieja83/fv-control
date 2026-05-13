/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCK_INVOICES?: string
  readonly VITE_PUBLIC_SUPPORT_EMAIL?: string
  /** Plausible site id (e.g. fv.resta.biz) — script loads only after analytics consent. */
  readonly VITE_PLAUSIBLE_DOMAIN?: string
  /** Optional override, default https://plausible.io/js/script.js (self-hosted EU plausible). */
  readonly VITE_PLAUSIBLE_SCRIPT_SRC?: string
  /** Full Calendly embed URL for iframe src, e.g. https://calendly.com/you/30min */
  readonly VITE_CALENDLY_EMBED_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
