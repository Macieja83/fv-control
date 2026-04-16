import { readApiErrorMessage } from './http'
const API = '/api/v1'

export type GusLookupDto = {
  nip: string
  regon: string | null
  name: string
  address: string
  raw: Record<string, string | null>
}

/** Pobiera dane podmiotu z publicznej usługi BIR (GUS) po NIP — wymaga skonfigurowanego klucza po stronie API. */
export async function fetchGusByNip(token: string, nipDigits: string): Promise<GusLookupDto> {
  const res = await fetch(`${API}/integrations/gus/nip/${encodeURIComponent(nipDigits)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as GusLookupDto
}
