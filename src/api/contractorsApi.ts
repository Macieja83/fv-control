import { readApiErrorMessage } from './http'
const API = '/api/v1'

export type ContractorDto = {
  id: string
  tenantId: string
  name: string
  nip: string
  address: string | null
  email: string | null
  phone: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export async function fetchContractors(token: string): Promise<ContractorDto[]> {
  const res = await fetch(`${API}/contractors`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as ContractorDto[]
}

export async function createContractor(
  token: string,
  body: { name: string; nip: string; address?: string | null; email?: string | null; phone?: string | null },
): Promise<ContractorDto> {
  const res = await fetch(`${API}/contractors`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
  return (await res.json()) as ContractorDto
}

export async function deleteContractor(token: string, id: string): Promise<void> {
  const res = await fetch(`${API}/contractors/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await readApiErrorMessage(res))
}
