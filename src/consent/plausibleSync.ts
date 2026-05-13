import { acceptedCategory } from 'vanilla-cookieconsent'
import { mountPlausible, unmountPlausible } from './plausibleLoader'

function plausibleDomain(): string {
  const d = import.meta.env.VITE_PLAUSIBLE_DOMAIN
  return typeof d === 'string' ? d.trim() : ''
}

/** Load or remove Plausible based on analytics consent and env. */
export function syncPlausible(): void {
  const domain = plausibleDomain()
  if (!domain) {
    unmountPlausible()
    return
  }
  if (acceptedCategory('analytics')) {
    mountPlausible(domain)
  } else {
    unmountPlausible()
  }
}
