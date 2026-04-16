export type AppNavKey =
  | 'invoices'
  | 'reports'
  | 'documents'
  | 'payments'
  | 'contractors'
  | 'settings'
  | 'admin'

export type AppNavItem = { key: AppNavKey; label: string; short: string }

/** Zakładki widoczne dla każdego zalogowanego tenanta. */
export const APP_NAV_ITEMS: AppNavItem[] = [
  { key: 'invoices', label: 'Faktury', short: 'FV' },
  { key: 'reports', label: 'Raporty', short: 'Rap.' },
  { key: 'documents', label: 'Umowy', short: 'Umowy' },
  { key: 'payments', label: 'Płatności', short: 'Płat.' },
  { key: 'contractors', label: 'Kontrahenci', short: 'Kontr.' },
  { key: 'settings', label: 'Firma', short: 'Firma' },
]

/** Tylko konto operatora platformy (`PLATFORM_ADMIN_EMAIL` w API). */
export const PLATFORM_ADMIN_NAV_ITEM: AppNavItem = { key: 'admin', label: 'Admin', short: 'Admin' }
