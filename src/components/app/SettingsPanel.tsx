import { useCallback, useEffect, useState } from 'react'
import { fetchTenantProfile, patchTenantProfile, type TenantProfileResponse } from '../../api/tenantApi'
import { getStoredToken } from '../../auth/session'

export function SettingsPanel() {
  const [name, setName] = useState('')
  const [nip, setNip] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const load = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      setErr('Brak sesji.')
      setLoading(false)
      return
    }
    setLoading(true)
    setErr(null)
    try {
      const t: TenantProfileResponse = await fetchTenantProfile(token)
      setName(t.name)
      setNip(t.nip ?? '')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = getStoredToken()
    if (!token) return
    setSaving(true)
    setOk(false)
    setErr(null)
    try {
      await patchTenantProfile(token, {
        name: name.trim(),
        nip: nip.replace(/\s/g, '') || null,
      })
      setOk(true)
      await load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="workspace-panel">
      <header className="workspace-panel__head">
        <div>
          <h2 className="workspace-panel__title">Ustawienia firmy</h2>
          <p className="workspace-panel__lead">Nazwa i NIP widoczne na fakturach i w integracjach.</p>
        </div>
      </header>

      {loading && <p className="workspace-panel__muted">Ładowanie…</p>}
      {err && <p className="workspace-panel__err">{err}</p>}
      {ok && <p className="workspace-panel__ok">Zapisano.</p>}

      {!loading && (
        <form className="settings-form" onSubmit={onSave}>
          <label>
            <span>Nazwa firmy</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={300} />
          </label>
          <label>
            <span>NIP</span>
            <input value={nip} onChange={(e) => setNip(e.target.value)} inputMode="numeric" maxLength={20} />
          </label>
          <div className="settings-form__actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Zapis…' : 'Zapisz'}
            </button>
          </div>
        </form>
      )}

      <section className="integration-card integration-card--tight">
        <h3 className="workspace-panel__h3">Integracje</h3>
        <p className="workspace-panel__muted">
          Szczegóły połączenia z bankiem i KSeF znajdziesz w module <strong>Płatności</strong> oraz w konfiguracji
          serwera API (zmienne środowiskowe, certyfikaty).
        </p>
      </section>
    </div>
  )
}
