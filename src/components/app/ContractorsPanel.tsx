import { useCallback, useEffect, useState } from 'react'
import {
  createContractor,
  deleteContractor,
  fetchContractors,
  type ContractorDto,
} from '../../api/contractorsApi'
import { getStoredToken } from '../../auth/session'

function normalizeNip(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 14)
}

export function ContractorsPanel() {
  const [rows, setRows] = useState<ContractorDto[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [nip, setNip] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      setErr('Brak sesji.')
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    setErr(null)
    try {
      setRows(await fetchContractors(token))
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = getStoredToken()
    if (!token) return
    const n = normalizeNip(nip)
    if (!name.trim() || n.length < 10) {
      window.alert('Podaj nazwę i poprawny NIP (min. 10 cyfr).')
      return
    }
    setSaving(true)
    try {
      await createContractor(token, { name: name.trim(), nip: n })
      setName('')
      setNip('')
      await load()
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (id: string, label: string) => {
    if (!window.confirm(`Usunąć kontrahenta „${label}”?`)) return
    const token = getStoredToken()
    if (!token) return
    try {
      await deleteContractor(token, id)
      await load()
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="workspace-panel">
      <header className="workspace-panel__head">
        <div>
          <h2 className="workspace-panel__title">Kontrahenci</h2>
          <p className="workspace-panel__lead">
            Lista zaufanych dostawców. Gdy wpłynie faktura kosztowa bez dopasowanego kontrahenta, zobaczysz
            ostrzeżenie w tabeli faktur — dodaj tutaj NIP, aby kolejne faktury były rozpoznawane.
          </p>
        </div>
      </header>

      <form className="contractor-form" onSubmit={onAdd}>
        <h3 className="workspace-panel__h3">Nowy kontrahent</h3>
        <div className="contractor-form__row">
          <label>
            <span>Nazwa</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={300} />
          </label>
          <label>
            <span>NIP</span>
            <input
              value={nip}
              onChange={(e) => setNip(e.target.value)}
              required
              inputMode="numeric"
              autoComplete="off"
              placeholder="np. 8393028257"
            />
          </label>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Zapis…' : 'Dodaj'}
          </button>
        </div>
      </form>

      {err && <p className="workspace-panel__err">{err}</p>}
      {loading ? (
        <p className="workspace-panel__muted">Ładowanie…</p>
      ) : (
        <div className="contractor-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th>NIP</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="mono">{r.nip}</td>
                  <td className="td-actions">
                    <button type="button" className="btn-ghost btn-danger" onClick={() => void onDelete(r.id, r.name)}>
                      Usuń
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && !err && <p className="workspace-panel__muted">Brak kontrahentów — dodaj pierwszy wpis.</p>}
        </div>
      )}
    </div>
  )
}
