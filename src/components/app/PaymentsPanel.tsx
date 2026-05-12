import { useCallback, useEffect, useState } from 'react'
import {
  deleteTenantKsefCredentials,
  fetchTenantKsefCredentialsPublic,
  fetchTenantProfile,
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
  if (r.ok) {
    if (r.probe === 'draft') {
      return 'Połączenie z KSeF działa — sprawdzono dane wpisane powyżej (jeszcze bez zapisu).'
    }
    return 'Połączenie z KSeF działa — użyto zapisanych poświadczeń.'
  }
  return r.message ?? 'Nie udało się połączyć z KSeF. Sprawdź klucz, PIN i certyfikat.'
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

export function PaymentsPanel(props: {
  embedded?: boolean
  onPortalIntegrationsChange?: (state: TenantProfileResponse['portalIntegrations']) => void
}) {
  const { embedded = false, onPortalIntegrationsChange } = props
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
      onPortalIntegrationsChange?.(t.portalIntegrations)
      setKsefMeta(k)
      setKsefConnector(sync)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [onPortalIntegrationsChange])

  useEffect(() => {
    void load()
  }, [load])

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
        setSyncMsg('Synchronizacja jest już w toku — poczekaj chwilę i odśwież status poniżej.')
      } else {
        setSyncMsg('Wysłano żądanie pobrania faktur — może to potrwać kilka minut. Potem kliknij „Odśwież status”.')
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

  const onTestKsefSmart = async () => {
    if (ksefToken.trim()) {
      await onTestKsefDraft()
      return
    }
    if (ksefMeta?.storedCredential) {
      await onTestKsefSaved()
      return
    }
    setKsefMsg('Wklej klucz z portalu KSeF albo najpierw zapisz poświadczenia — wtedy można sprawdzić połączenie.')
  }

  const body = (
    <>
      {loading && <p className="workspace-panel__muted">Ładowanie…</p>}
      {err && <p className="workspace-panel__err">{err}</p>}

      {state && (
        <>
          <section className="integration-card">
            <h3 className="workspace-panel__h3">Konto bankowe</h3>
            <p className="workspace-panel__muted">
              <strong>W przygotowaniu.</strong> Konfiguracja powiązania konta bankowego z aplikacją jest w trakcie prac —
              w przyszłości pojawi się tu możliwość bezpiecznego połączenia (np. w kontekście przyszłej integracji PISP /
              podglądu operacji). Na razie płatności do kontrahentów realizujesz jak dotąd: przelewem na podstawie danych z
              faktury (numer konta, kwota, tytuł).
            </p>
          </section>

          <section className="integration-card integration-card--ksef">
            <h3 className="workspace-panel__h3">KSeF</h3>
            <p className="workspace-panel__muted">
              Pobieranie faktur z Ministerstwa Finansów do tej aplikacji. Poniżej wklejasz dane z portalu KSeF — są one
              przechowywane w sposób szyfrowany.
            </p>

            <div className="ksef-block">
              <h4 className="ksef-block__title">Synchronizacja</h4>
              <p className="workspace-panel__muted">
                Faktury są pobierane automatycznie oraz na żądanie — gdy poświadczenia są już zapisane.
              </p>
              {!ksefConnector?.configured && (
                <p className="workspace-panel__muted">Najpierw uzupełnij i zapisz dane w sekcji niżej.</p>
              )}
              {ksefConnector && (
                <>
                  <div className="ksef-simple-status">
                    <p>
                      <strong>Ostatnia synchronizacja:</strong>{' '}
                      {ksefConnector.lastSyncRunAt ?
                        new Date(ksefConnector.lastSyncRunAt).toLocaleString('pl-PL')
                      : 'jeszcze nie było'}
                      {ksefConnector.lastSyncPhase ?
                        <>
                          {' '}
                          ({formatKsefPhase(ksefConnector.lastSyncPhase)})
                        </>
                      : null}
                      {ksefConnector.lastSyncOk != null ?
                        <>
                          {' '}
                          — <strong>{ksefConnector.lastSyncOk ? 'ukończona poprawnie' : 'był problem'}</strong>
                        </>
                      : null}
                    </p>
                    <p>
                      <strong>Faktury z KSeF w aplikacji:</strong> {ksefConnector.invoiceCount}
                    </p>
                    <p>
                      <strong>Automatyczne pobieranie:</strong>{' '}
                      {ksefConnector.autoSyncIntervalMs > 0 ?
                        `co ok. ${Math.max(1, Math.round(ksefConnector.autoSyncIntervalMs / 60000))} min`
                      : 'wyłączone'}
                    </p>
                    {!ksefConnector.queue.redisAvailable && (
                      <p className="workspace-panel__err">
                        Serwer nie może teraz obsłużyć kolejki synchronizacji — skontaktuj się z administratorem aplikacji.
                      </p>
                    )}
                    {ksefConnector.lastSyncSkippedReason && (
                      <p className="workspace-panel__muted">
                        <strong>Uwaga:</strong> {ksefConnector.lastSyncSkippedReason}
                      </p>
                    )}
                    {ksefConnector.lastSyncErrorPreview && (
                      <p className="workspace-panel__err" style={{ whiteSpace: 'pre-wrap' }}>
                        {ksefConnector.lastSyncErrorPreview}
                      </p>
                    )}
                    {ksefConnector.queue.lastJobError &&
                      (ksefConnector.queue.lastJobState === 'failed' || ksefConnector.queue.lastJobState === 'retrying') && (
                        <p className="workspace-panel__err" style={{ whiteSpace: 'pre-wrap' }}>
                          {ksefConnector.queue.lastJobError}
                          {ksefConnector.queue.lastJobFinalFailure === true ?
                            ' (wyczerpano ponowienia.)'
                          : ksefConnector.queue.lastJobState === 'retrying' ?
                            ' (planowane ponowienie.)'
                          : null}
                        </p>
                      )}
                  </div>

                  <details className="ksef-tech-details">
                    <summary>Szczegóły techniczne (opcjonalnie)</summary>
                    <dl className="detail-dl ksef-tech-details__dl">
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
                        : '—'}
                        {ksefConnector.lastSyncPhase ?
                          <>
                            {' '}
                            · faza: <strong>{formatKsefPhase(ksefConnector.lastSyncPhase)}</strong>
                          </>
                        : null}
                        {ksefConnector.lastSyncOk != null ?
                          <>
                            {' '}
                            · <strong>{ksefConnector.lastSyncOk ? 'OK' : 'problem'}</strong>
                          </>
                        : null}
                      </dd>
                      {ksefConnector.lastSyncStats && (
                        <>
                          <dt>Statystyki ostatniego przebiegu</dt>
                          <dd className="mono" style={{ marginBottom: 8 }}>
                            metadane: {String(ksefConnector.lastSyncStats.fetched ?? '—')} · import:{' '}
                            {String(ksefConnector.lastSyncStats.ingested ?? '—')} · dupl.:{' '}
                            {String(ksefConnector.lastSyncStats.skippedDuplicate ?? '—')} · XML:{' '}
                            {String(ksefConnector.lastSyncStats.refetched ?? '—')} · błędy:{' '}
                            {String(ksefConnector.lastSyncStats.errorCount ?? '—')}
                          </dd>
                        </>
                      )}
                      <dt>Auto-sync (interwał serwera)</dt>
                      <dd>
                        {ksefConnector.autoSyncIntervalMs > 0 ?
                          `${Math.round(ksefConnector.autoSyncIntervalMs / 1000)} s`
                        : '0 (wyłączone)'}
                      </dd>
                      <dt>Kolejka</dt>
                      <dd style={{ marginBottom: 8 }}>
                        {ksefConnector.queue.redisAvailable ?
                          <>
                            Zadanie: <span className="mono">{ksefConnector.queue.autoDedupeJobId || '—'}</span> —{' '}
                            <strong>{formatBullMqState(ksefConnector.queue.autoJobState)}</strong>
                            {ksefConnector.queue.pendingOrActiveOtherJobs > 0 ?
                              <>
                                {' '}
                                · inne aktywne: <strong>{ksefConnector.queue.pendingOrActiveOtherJobs}</strong>
                              </>
                            : null}
                          </>
                        : 'brak odczytu kolejki'}
                      </dd>
                      <dt>Ostatni job</dt>
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
                    </dl>
                  </details>
                </>
              )}
              {syncMsg && (
                <p
                  className={
                    syncMsg.includes('Wysłano') || syncMsg.includes('w toku') || syncMsg.includes('kolejce')
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
                  {syncRunBusy ? 'Wysyłanie…' : 'Pobierz faktury teraz'}
                </button>
                <button type="button" className="btn-ghost" disabled={syncRefreshing || syncRunBusy} onClick={() => void onRefreshKsefSync()}>
                  {syncRefreshing ? 'Odświeżanie…' : 'Odśwież status'}
                </button>
              </div>
            </div>

            <div className="ksef-block ksef-block--credentials">
              <h4 className="ksef-block__title">Dane logowania do KSeF</h4>
              <p className="workspace-panel__muted">
                Skopiuj z portalu Ministerstwa Finansów. Opcjonalnie dołącz certyfikat, jeśli logujesz się w ten sposób.
              </p>
              {ksefMeta && (
                <label className="settings-form" style={{ marginBottom: 12 }}>
                  <span>Środowisko</span>
                  <select
                    disabled={ksefEnvSaving}
                    value={ksefMeta.ksefEnvOverride ?? ''}
                    onChange={(e) => void onKsefEnvSelect(e.target.value)}
                  >
                    <option value="">Jak ustawione na serwerze ({ksefMeta.serverEnvironment})</option>
                    <option value="sandbox">Tryb testowy (sandbox)</option>
                    <option value="production">Produkcja</option>
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
                  <strong>Status:</strong> poświadczenia zapisane w aplikacji.
                  {ksefMeta.authMode ?
                    <>
                      {' '}
                      Tryb: <strong>{ksefMeta.authMode}</strong>.
                    </>
                  : null}
                </p>
              )}
              {ksefMsg && (
                <p
                  className={
                    ksefMsg.startsWith('Zapisano') ||
                    ksefMsg.startsWith('Usunięto') ||
                    ksefMsg.startsWith('Połączenie z KSeF działa')
                      ? 'workspace-panel__ok'
                      : 'workspace-panel__err'
                  }
                >
                  {ksefMsg}
                </p>
              )}
              <label className="settings-form">
                <span>Klucz lub token z portalu KSeF</span>
                <textarea
                  className="settings-form__textarea"
                  rows={5}
                  value={ksefToken}
                  onChange={(e) => setKsefToken(e.target.value)}
                  placeholder="Wklej tutaj dane skopiowane z portalu…"
                  autoComplete="off"
                />
              </label>
              <label className="settings-form">
                <span>PIN lub hasło (jeśli portal tego wymaga)</span>
                <input
                  type="password"
                  value={ksefPin}
                  onChange={(e) => setKsefPin(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label className="settings-form">
                <span>Plik certyfikatu (jeśli używasz certyfikatu)</span>
                <input
                  type="file"
                  accept=".pem,.crt,.cer"
                  onChange={(e) => void onCertFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <details className="ksef-cert-paste">
                <summary>Wklej certyfikat zamiast pliku</summary>
                <label className="settings-form">
                  <span className="workspace-panel__muted">Treść certyfikatu (PEM)</span>
                  <textarea
                    className="settings-form__textarea"
                    rows={4}
                    value={ksefCertText}
                    onChange={(e) => setKsefCertText(e.target.value)}
                    placeholder="-----BEGIN CERTIFICATE----- …"
                  />
                </label>
              </details>
              <div className="settings-form__actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={testBusy || ksefSaving || (!ksefToken.trim() && !ksefMeta?.storedCredential)}
                  onClick={() => void onTestKsefSmart()}
                >
                  {testBusy ? 'Sprawdzanie…' : 'Sprawdź połączenie'}
                </button>
              </div>
              <p className="workspace-panel__muted ksef-test-hint">
                Sprawdza wpisane powyżej dane; gdy pole klucza jest puste — używa ostatnio zapisanych poświadczeń.
              </p>
              <div className="settings-form__actions">
                <button type="button" className="btn-primary" disabled={ksefSaving || testBusy || !ksefToken.trim()} onClick={() => void onSaveKsef()}>
                  {ksefSaving ? 'Zapis…' : 'Zapisz'}
                </button>
                <button type="button" className="btn-ghost" disabled={ksefSaving || testBusy || !ksefMeta?.storedCredential} onClick={() => void onRemoveKsef()}>
                  Usuń zapisane dane
                </button>
              </div>
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
            Płatności <strong>za faktury do kontrahentów</strong> — przelew na podstawie danych z faktury; integracja konta
            bankowego w aplikacji jest <strong>w przygotowaniu</strong>. Abonament (Stripe) jest w{' '}
            <strong>Ustawienia</strong>.
          </p>
        </div>
      </header>
      {body}
    </div>
  )
}
