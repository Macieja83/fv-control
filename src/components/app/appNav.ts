export type AppNavKey = 'invoices' | 'documents' | 'payments' | 'contractors' | 'settings'

export const APP_NAV_ITEMS: { key: AppNavKey; label: string; short: string }[] = [
  { key: 'invoices', label: 'Faktury', short: 'FV' },
  { key: 'documents', label: 'Umowy', short: 'Umowy' },
  { key: 'payments', label: 'Płatności', short: 'Płat.' },
  { key: 'contractors', label: 'Kontrahenci', short: 'Kontr.' },
  { key: 'settings', label: 'Firma', short: 'Firma' },
]
