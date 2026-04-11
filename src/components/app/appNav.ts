export type AppNavKey = 'inbox' | 'documents' | 'payments' | 'contractors' | 'settings'

export const APP_NAV_ITEMS: { key: AppNavKey; label: string; short: string }[] = [
  { key: 'inbox', label: 'Inbox', short: 'Inbox' },
  { key: 'documents', label: 'Dokumenty', short: 'Dok.' },
  { key: 'payments', label: 'Płatności', short: 'Płat.' },
  { key: 'contractors', label: 'Kontrahenci', short: 'Kontr.' },
  { key: 'settings', label: 'Firma', short: 'Firma' },
]
