import { useCallback, useEffect, useState } from 'react'
import {
  deleteTenantKsefCredentials,
  fetchTenantKsefCredentialsPublic,
  fetchTenantProfile,
  patchTenantIntegrations,
  postTenantKsefConnectionTest,
  putTenantKsefCredentials,
  type TenantKsefCredentialsPublic,
  type TenantKsefTestResult,
  type TenantProfileResponse,
} from '../../api/tenantApi'
import {
  fetchKsefConnectorStatus,
  patchKsefConnectorSettings,
  postKsefSync,
  type KsefConnectorStatus,
} from '../../api/ksefApi'
import { getStoredToken } from '../../auth/session'

const BANKS = [
  'PKO BP',
  'mBank',
  'ING',
  'Santander',
  'Millennium',
  'Alior Bank',
  'BNP Paribas',
  'Pekao S.A.',
  'Velo Bank',
  'Nest Bank',
  'Inteligo',
  'Credit Agricole',
]

function formatBullMqState(state: string | null): string {
  if (!state) return '—'
  const m: Record<string, string> = {
    waiting: 'oczekuje',
    active: 'w toku',
    delayed: 'opóźniony',
    completed: 'ukończony',
    failed: 'niepowodzenie',
    paused: 'wstrzymany',
    'waiting-children': 'oczekuje (children)',
  }
  return m[state] ?? state
}

function formatKsefPhase(phase: string | null): string {
  switch (phase) {
    case 'completed':
      return 'zakończono'
    case 'failed':
      return 'błąd'
    case 'skipped_no_credentials':
      return 'pominięto (brak poświadczeń)'
    default:
      return phase ?? '—'
  }
}

function formatKsefTestResult(r: TenantKsefTestResult): string {
  const src =
    r.credentialSource === 'tenant' ? 'tenant (baza)' : r.credentialSource === 'global' ? 'serwer (.env)' : '—'
  const scope = r.probe === 'draft' ? 'formularz (bez zapisu)' : 'zapis w bazie'
  if (r.ok) {
    return `Połączenie OK — ${scope}, źródło: ${src}${r.accessValidUntil ? `; accessToken do: ${r.accessValidUntil}` : ''}.`
  }
  return `Test KSeF nieudany (${scope}, źródło: ${src}): ${r.message ?? 'nieznany błąd'}`
}

function fileToCertField(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const res = r.result
      if (typeof res === 'string') {
        resolve(res.trim())
        return
      }
      if (res instanceof ArrayBuffer) {
        const bytes = new Uint8Array(res)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
        resolve(btoa(bin))
        return
      }
      reject(new Error('Nieobsługiwany plik certyfikatu.'))
    }
    r.onerror = () => reject(r.error ?? new Error('Odczyt pliku nie powiódł się.'))
    const name = file.name.toLowerCase()
    if (name.endsWith('.pem') || file.type.includes('text')) {
      r.readAsText(file)
    } else {
      r.readAsArrayBuffer(file)
    }
  })
}

export function PaymentsPanel(props: { embedded?: boolean }) {
  const { embedded = false } = props
  const [state, setState] = useState<TenantProfileResponse['portalIntegrations'] | null>(null)
  const [ksefMeta, setKsefMeta] = useState<TenantKsefCredentialsPublic | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [ksefToken, setKsefToken] = useState('')
  const [ksefPin, setKsefPin] = useState('')
  const [ksefCertText, setKsefCertText] = useState('')
  const [ksefSaving, setKsefSaving] = useState(false)
  const [ksefMsg, setKsefMsg] = useState<string | null>(null)
  const [testBusy, setTestBusy] = useState(false)
  const [ksefConnector, setKsefConnector] = useState<KsefConnectorStatus | null>(null)
  const [syncRefreshing, setSyncRefreshing] = useState(false)
  const [syncRunBusy, setSyncRunBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [ksefEnvSaving, setKsefEnvSaving] = useState(false)

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
      const [t, k, sync] = await Promise.all([
        fetchTenantProfile(token),
        fetchTenantKsefCredentialsPublic(token),
        fetchKsefConnectorStatus(token).catch(() => null),
      ])
      setState(t.portalIntegrations)
      setKsefMeta(k)
      setKsefConnector(sync)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const connectBank = async (label: string) => {
    const token = getStoredToken()
    if (!token) return
    try {
      const next = await patchTenantIntegrations(token, { bankConnected: true, bankLabel: label })
      setState(next)
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  const clearBank = async () => {
    const token = getStoredToken()
    if (!token) return
    try {
      const next = await patchTenantIntegrations(token, { bankConnected: false, bankLabel: null })
      setState(next)
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  const onSaveKsef = async () => {
    const token = getStoredToken()
    if (!token) return
    setKsefSaving(true)
    setKsefMsg(null)
    try {
      await putTenantKsefCredentials(token, {
        ksefTokenOrEncryptedBlob: ksefToken.trim(),
        tokenPassword: ksefPin.trim() || null,
        certPemOrDerBase64: ksefCertText.trim() || null,
      })
      setKsefMsg('Zapisano poświadczenia KSeF.')
      setKsefPin('')
      await load()
    } catch (e: unknown) {
      setKsefMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setKsefSaving(false)
    }
  }

  const onRemoveKsef = async () => {
    if (!window.confirm('Usunąć zapisane poświadczenia KSeF dla tej firmy?')) return
    const token = getStoredToken()
    if (!token) return
    setKsefSaving(true)
    setKsefMsg(null)
    try {
      await deleteTenantKsefCredentials(token)
      setKsefToken('')
      setKsefPin('')
      setKsefCertText('')
      setKsefMsg('Usunięto konfigurację KSeF.')
      await load()
    } catch (e: unknown) {
      setKsefMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setKsefSaving(false)
    }
  }

  const onCertFile = async (f: File | null) => {
    if (!f) return
    try {
      const s = await fileToCertField(f)
      setKsefCertText(s)
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  const onTestKsefSaved = async () => {
    const token = getStoredToken()
    if (!token) return
    setTestBusy(true)
    setKsefMsg(null)
    try {
      const r = await postTenantKsefConnectionTest(token, null)
      setKsefMsg(formatKsefTestResult(r))
    } catch (e: unknown) {
      setKsefMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setTestBusy(false)
    }
  }

  const onRefreshKsefSync = async () => {
    const token = getStoredToken()
    if (!token) return
    setSyncRefreshing(true)
    setSyncMsg(null)
    try {
      setKsefConnector(await fetchKsefConnectorStatus(token))
    } catch (e: unknown) {
      setSyncMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncRefreshing(false)
    }
  }

  const onKsefEnvSelect = async (raw: string) => {
    const token = getStoredToken()
    if (!token) return
    const ksefApiEnv = raw === '' ? null : (raw as 'sandbox' | 'production')
    setKsefEnvSaving(true)
    setKsefMsg(null)
    try {
      await patchKsefConnectorSettings(token, ksefApiEnv)
      await load()
      setKsefMsg('Zapisano ustawienie środowiska KSeF.')
    } catch (e: unknown) {
      setKsefMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setKsefEnvSaving(false)
    }
  }

  const onRunKsefSync = async () => {
    const token = getStoredToken()
    if (!token) return
    setSyncRunBusy(true)
    setSyncMsg(null)
    try {
      const r = await postKsefSync(token, {})
      if (r.dedupeSkipped) {
        setSyncMsg(
          'Synchronizacja już jest w kolejce lub w toku — poczekaj na zakończenie i kliknij „Odśwież status”.',
        )
      } else {
        setSyncMsg(
          `Zadanie zapisane w kolejce (job: ${String(r.jobId ?? '—')}). Pobranie może trwać kilka minut — potem odśwież status.`,
        )
      }
    } catch (e: unknown) {
      setSyncMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncRunBusy(false)
    }
  }

  const onTestKsefDraft = async () => {
    const token = getStoredToken()
    if (!token) return
    setTestBusy(true)
    setKsefMsg(null)
    try {
      const r = await postTenantKsefConnectionTest(token, {
        ksefTokenOrEncryptedBlob: ksefToken.trim(),
        tokenPassword: ksefPin.trim() || null,
        certPemOrDerBase64: ksefCertText.trim() || null,
      })
      setKsefMsg(formatKsefTestResult(r))
    } catch (e: unknown) {
      setKsefMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setTestBusy(false)
    }
  }

  const body = (
    <>
      {loading && <p className="workspace-panel__muted">Ładowanie…</p>}
      {err && <p className="workspace-panel__err">{err}</p>}

      {state && (
        <>
          <section className="integration-card">
            <h3 className="workspace-panel__h3">Konto bankowe</h3>
            {state.bankConnected ? (
              <div>
                <p>
                  Połączono: <strong>{state.bankLabel ?? '—'}</strong>
                </p>
                <button type="button" className="btn-ghost" onClick={() => void clearBank()}>
                  Rozłącz
                </button>
              </div>
            ) : (
              <>
                <p className="workspace-panel__muted">Wybierz bank, z którym chcesz powiązać konto (symulacja zgody).</p>
                <div className="bank-grid">
                  {BANKS.map((b) => (
                    <button key={b} type="button" className="bank-grid__tile" onClick={() => void connectBank(b)}>
                      {b}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="integration-card">
            <h3 className="workspace-panel__h3">KSeF — synchronizacja faktur (import z API)</h3>
            <p className="workspace-panel__muted">
              Worker okresowo pobiera metadane i XML z KSeF. Tu widzisz ostatni przebieg i możesz wymusić kolejkę ręcznie
              (wymaga skonfigurowanych poświadczeń i worker + Redis na serwerze).
            </p>
            {!ksefConnector?.configured && (
              <p className="workspace-panel__muted">
                Najpierw zapisz poświadczenia KSeF poniżej — bez tego synchronizacja się nie uruchomi.
              </p>
            )}
            {ksefConnector && (
              <dl className="detail-dl" style={{ marginBottom: 12 }}>
                <dt>Znacznik przyrostu (HWM)</dt>
                <dd className="mono" style={{ marginBottom: 8 }}>
                  {ksefConnector.lastSyncHwmDate != null && ksefConnector.lastSyncHwmDate !== ''
                    ? String(ksefConnector.lastSyncHwmDate)
                    : '— (pierwszy sync pobierze od domyślnego okna)'}
                </dd>
                <dt>Ostatni przebieg sync</dt>
                <dd style={{ marginBottom: 8 }}>
                  {ksefConnector.lastSyncRunAt ?
                    new Date(ksefConnector.lastSyncRunAt).toLocaleString('pl-PL')
                  : '— (jeszcze nie było ukończonego joba)'}
                  {ksefConnector.lastSyncPhase ?
                    <>
                      {' '}
                      · faza: <strong>{formatKsefPhase(ksefConnector.lastSyncPhase)}</strong>
                    </>
                  : null}
                  {ksefConnector.lastSyncOk != null ?
                    <>
                      {' '}
                      ·{' '}
                      <strong>{ksefConnector.lastSyncOk ? 'OK' : 'problem'}</strong>
                    </>
                  : null}
                </dd>
                {ksefConnector.lastSyncSkippedReason && (
                  <>
                    <dt>Powód pominięcia</dt>
                    <dd style={{ marginBottom: 8 }}>{ksefConnector.lastSyncSkippedReason}</dd>
                  </>
                )}
                {ksefConnector.lastSyncStats && (
                  <>
                    <dt>Statystyki ostatniego przebiegu</dt>
                    <dd className="mono" style={{ marginBottom: 8 }}>
                      pobrane metadane: {String(ksefConnector.lastSyncStats.fetched ?? '—')} · import:{' '}
                      {String(ksefConnector.lastSyncStats.ingested ?? '—')} · pom. dupl.:{' '}
                      {String(ksefConnector.lastSyncStats.skippedDuplicate ?? '—')} · pon. XML:{' '}
                      {String(ksefConnector.lastSyncStats.refetched ?? '—')} · błędy:{' '}
                      {String(ksefConnector.lastSyncStats.errorCount ?? '—')}
                    </dd>
                  </>
                )}
                {ksefConnector.lastSyncErrorPreview && (
                  <>
                    <dt>Fragment błędów</dt>
                    <dd className="workspace-panel__err" style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>
                      {ksefConnector.lastSyncErrorPreview}
                    </dd>
                  </>
                )}
                <dt>Faktury z importu KSeF w bazie</dt>
                <dd>{ksefConnector.invoiceCount}</dd>
                <dt>Auto-sync (worker)</dt>
                <dd>
                  {ksefConnector.autoSyncIntervalMs > 0 ?
                    `co ${Math.round(ksefConnector.autoSyncIntervalMs / 1000)} s`
                  : 'wyłączone (KSEF_AUTO_SYNC_INTERVAL_MS=0)'}
                </dd>
                <dt>Kolejka (BullMQ / Redis)</dt>
                <dd style={{ marginBottom: 8 }}>
                  {ksefConnector.queue.redisAvailable ?
                    <>
                      Zadanie cykliczne: <span className="mono">{ksefConnector.queue.autoDedupeJobId || '—'}</span> —{' '}
                      <strong>{formatBullMqState(ksefConnector.queue.autoJobState)}</strong>
                      {ksefConnector.queue.pendingOrActiveOtherJobs > 0 ?
                        <>
                          {' '}
                          · inne w kolejce / aktywne: <strong>{ksefConnector.queue.pendingOrActiveOtherJobs}</strong>
                        </>
                      : null}
                    </>
                  : 'API nie odczytało kolejki (np. brak Redis po stronie serwera aplikacji).'}
                </dd>
                <dt>Ostatni job worker</dt>
                <dd className="mono" style={{ marginBottom: 8 }}>
                  {ksefConnector.queue.lastJobId ?? '—'}
                  {ksefConnector.queue.lastJobState ?
                    <>
                      {' '}
                      · {ksefConnector.queue.lastJobState}
                    </>
                  : null}
                  {ksefConnector.queue.lastJobFinishedAt ?
                    <>
                      {' '}
                      · {new Date(ksefConnector.queue.lastJobFinishedAt).toLocaleString('pl-PL')}
                    </>
                  : null}
                  {ksefConnector.queue.lastJobAttempts != null && ksefConnector.queue.lastJobMaxAttempts != null ?
                    <>
                      {' '}
                      · próby {ksefConnector.queue.lastJobAttempts}/{ksefConnector.queue.lastJobMaxAttempts}
                    </>
                  : null}
                </dd>
                {ksefConnector.queue.lastJobError &&
                  (ksefConnector.queue.lastJobState === 'failed' || ksefConnector.queue.lastJobState === 'retrying') && (
                    <>
                      <dt>Błąd joba (kolejka)</dt>
                      <dd className="workspace-panel__err" style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>
                        {ksefConnector.queue.lastJobError}
                        {ksefConnector.queue.lastJobFinalFailure === true ?
                          ' — wyczerpano ponowienia (ostateczne niepowodzenie).'
                        : ksefConnector.queue.lastJobState === 'retrying' ?
                          ' — planowane ponowienie przez workera.'
                        : null}
                      </dd>
                    </>
                  )}
              </dl>
            )}
            {syncMsg && (
              <p
                className={
                  syncMsg.startsWith('Zadanie zapisane') || syncMsg.includes('już jest w kolejce')
                    ? 'workspace-panel__ok'
                    : 'workspace-panel__err'
                }
              >
                {syncMsg}
              </p>
            )}
            <div className="settings-form__actions">
              <button
                type="button"
                className="btn-primary"
                disabled={syncRunBusy || syncRefreshing || !ksefConnector?.configured || ksefConnector?.environment === 'mock'}
                onClick={() => void onRunKsefSync()}
              >
                {syncRunBusy ? 'Kolejkowanie…' : 'Synchronizuj teraz'}
              </button>
              <button type="button" className="btn-ghost" disabled={syncRefreshing || syncRunBusy} onClick={() => void onRefreshKsefSync()}>
                {syncRefreshing ? 'Odświeżanie…' : 'Odśwież status'}
              </button>
            </div>
          </section>

          <section className="integration-card">
            <h3 className="workspace-panel__h3">KSeF — poświadczenia tej firmy</h3>
            <p className="workspace-panel__muted">
              Dane z portalu MF (token lub zaszyfrowany klucz + PIN) oraz opcjonalnie certyfikat X.509 są zapisywane
              szyfrowane w bazie i używane wyłącznie dla tego konta. Aktywne API:{' '}
              <strong>{ksefMeta?.environment ?? '—'}</strong>
              {ksefMeta ?
                <>
                  {' '}
                  (serwer: <span className="mono">{ksefMeta.serverEnvironment}</span>
                  {ksefMeta.ksefEnvOverride ?
                    <>
                      {' '}
                      · nadpisanie: <strong>{ksefMeta.ksefEnvOverride}</strong>
                    </>
                  : null}
                  ).
                </>
              : null}
            </p>
            {ksefMeta && (
              <label className="settings-form" style={{ marginBottom: 12 }}>
                <span>Środowisko API KSeF dla tej firmy</span>
                <select
                  disabled={ksefEnvSaving}
                  value={ksefMeta.ksefEnvOverride ?? ''}
                  onChange={(e) => void onKsefEnvSelect(e.target.value)}
                >
                  <option value="">Domyślnie (jak KSEF_ENV na serwerze: {ksefMeta.serverEnvironment})</option>
                  <option value="sandbox">Wymuszaj sandbox (testowe API MF)</option>
                  <option value="production">Wymuszaj produkcję</option>
                </select>
              </label>
            )}
            {ksefMeta && !ksefMeta.tenantNipOk && (
              <p className="workspace-panel__err">
                Uzupełnij poprawny 10-cyfrowy NIP w sekcji <strong>Nazwa firmy / NIP</strong> powyżej — bez tego KSeF nie
                zadziała.
              </p>
            )}
            {ksefMeta?.storedCredential && (
              <p className="workspace-panel__muted">
                Zapisana konfiguracja: <strong>tak</strong>
                {ksefMeta.authMode ? (
                  <>
                    {' '}
                    · tryb: <strong>{ksefMeta.authMode}</strong>
                  </>
                ) : null}
                .
              </p>
            )}
            {ksefMsg && (
              <p
                className={
                  ksefMsg.startsWith('Zapisano') ||
                  ksefMsg.startsWith('Usunięto') ||
                  ksefMsg.startsWith('Połączenie OK')
                    ? 'workspace-panel__ok'
                    : 'workspace-panel__err'
                }
              >
                {ksefMsg}
              </p>
            )}
            <label className="settings-form">
              <span>Token / zaszyfrowany klucz (z portalu KSeF lub PEM)</span>
              <textarea
                className="settings-form__textarea"
                rows={6}
                value={ksefToken}
                onChange={(e) => setKsefToken(e.target.value)}
                placeholder="Wklej zaszyfrowany ciąg Base64 z MF, PEM klucza lub surowy token (gdy bez PIN)…"
                autoComplete="off"
              />
            </label>
            <label className="settings-form">
              <span>Hasło / PIN do odszyfrowania (puste, jeśli token jest już jawny)</span>
              <input
                type="password"
                value={ksefPin}
                onChange={(e) => setKsefPin(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className="settings-form">
              <span>Certyfikat (opcjonalnie) — wklej PEM lub wybierz plik .pem / .crt</span>
              <textarea
                className="settings-form__textarea"
                rows={4}
                value={ksefCertText}
                onChange={(e) => setKsefCertText(e.target.value)}
                placeholder="-----BEGIN CERTIFICATE----- … (tylko przy uwierzytelnianiu certyfikatem)"
              />
            </label>
            <label className="settings-form">
              <span>Plik certyfikatu</span>
              <input
                type="file"
                accept=".pem,.crt,.cer"
                onChange={(e) => void onCertFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <p className="workspace-panel__muted" style={{ marginTop: '0.5rem' }}>
              <strong>Test połączenia</strong> wykonuje pełne logowanie do API MF (bez zapisu faktur). „Formularz” używa
              pól powyżej — możesz sprawdzić dane przed zapisem.
            </p>
            <div className="settings-form__actions">
              <button type="button" className="btn-ghost" disabled={testBusy || ksefSaving} onClick={() => void onTestKsefSaved()}>
                {testBusy ? 'Test…' : 'Testuj zapisane'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={testBusy || ksefSaving || !ksefToken.trim()}
                onClick={() => void onTestKsefDraft()}
              >
                {testBusy ? 'Test…' : 'Testuj formularz (bez zapisu)'}
              </button>
            </div>
            <div className="settings-form__actions">
              <button type="button" className="btn-primary" disabled={ksefSaving || testBusy || !ksefToken.trim()} onClick={() => void onSaveKsef()}>
                {ksefSaving ? 'Zapis…' : 'Zapisz KSeF'}
              </button>
              <button type="button" className="btn-ghost" disabled={ksefSaving || testBusy || !ksefMeta?.storedCredential} onClick={() => void onRemoveKsef()}>
                Usuń poświadczenia KSeF
              </button>
            </div>
          </section>
        </>
      )}
    </>
  )

  if (embedded) {
    return <div className="settings-embedded-payments">{body}</div>
  }

  return (
    <div className="workspace-panel">
      <header className="workspace-panel__head">
        <div>
          <h2 className="workspace-panel__title">Płatności</h2>
          <p className="workspace-panel__lead">
            Płatności <strong>za faktury do kontrahentów</strong> to przelew na konto z faktury (szczegóły faktury) lub
            przyszła integracja <strong>PISP</strong>. Abonament aplikacji (Stripe) jest w zakładce <strong>Ustawienia</strong>.
          </p>
        </div>
      </header>
      {body}
    </div>
  )
}
