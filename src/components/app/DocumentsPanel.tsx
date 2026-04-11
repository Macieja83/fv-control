import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgreementDetail, AgreementListRow, AgreementStatus } from '../../api/agreementsApi'
import {
  fetchAgreement,
  fetchAgreements,
  openAgreementDocumentBlobUrl,
  patchAgreement,
} from '../../api/agreementsApi'
import { fetchContractors, type ContractorDto } from '../../api/contractorsApi'
import { getStoredToken } from '../../auth/session'
import { AgreementUpload } from './AgreementUpload'

function toYmd(iso: string | null): string {
  if (!iso) return ''
  const d = iso.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''
}

function formatPlDate(iso: string | null): string {
  const ymd = toYmd(iso)
  if (!ymd) return '—'
  const [y, m, d] = ymd.split('-')
  return `${d}.${m}.${y}`
}

function statusLabel(s: AgreementStatus): string {
  switch (s) {
    case 'PROCESSING':
      return 'Przetwarzanie'
    case 'READY':
      return 'Gotowa'
    case 'FAILED':
      return 'Błąd odczytu'
    default:
      return s
  }
}

export function DocumentsPanel() {
  const [rows, setRows] = useState<AgreementListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [detail, setDetail] = useState<AgreementDetail | null>(null)
  const [contractors, setContractors] = useState<ContractorDto[]>([])
  const overlayRef = useRef<HTMLDivElement>(null)

  const loadList = useCallback(async () => {
    setListError(null)
    try {
      setRows(await fetchAgreements())
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Nie udało się wczytać umów.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  const openDetail = useCallback(async (id: string) => {
    setListError(null)
    try {
      const token = getStoredToken()
      const [ag, ctr] = await Promise.all([
        fetchAgreement(id),
        token ? fetchContractors(token).catch(() => []) : Promise.resolve([] as ContractorDto[]),
      ])
      setDetail(ag)
      setContractors(ctr)
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Błąd wczytywania umowy.')
    }
  }, [])

  const closeDetail = useCallback(() => setDetail(null), [])

  useEffect(() => {
    if (!detail) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [detail, closeDetail])

  const onOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) closeDetail()
  }

  const onOpenFile = async () => {
    if (!detail) return
    try {
      const url = await openAgreementDocumentBlobUrl(detail.id)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Nie udało się otworzyć pliku.')
    }
  }

  return (
    <div className="workspace-panel">
      <header className="workspace-panel__head">
        <div>
          <h2 className="workspace-panel__title">Umowy i dokumenty</h2>
          <p className="workspace-panel__lead">
            Przechowuj umowy z kontrahentami (PDF lub zdjęcie). Po wgraniu system odczyta tytuł, strony, daty i NIP —
            tak jak przy fakturach. Faktury znajdziesz w zakładce Faktury.
          </p>
        </div>
      </header>

      <AgreementUpload
        onUploaded={() => {
          void loadList()
        }}
      />

      {listError && (
        <p className="workspace-panel__muted" role="alert" style={{ color: 'var(--danger, #c0392b)' }}>
          {listError}
        </p>
      )}

      <div className="contractor-table-wrap" style={{ marginTop: '1rem' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Tytuł</th>
              <th>Kontrahent</th>
              <th>Status</th>
              <th>Obowiązuje do</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="workspace-panel__muted">
                  Wczytywanie…
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>
                    {r.contractor?.name ?? r.counterpartyName ?? '—'}
                    {(r.contractor?.nip ?? r.counterpartyNip) ? (
                      <span className="mono" style={{ marginLeft: 8, opacity: 0.85 }}>
                        {r.contractor?.nip ?? r.counterpartyNip}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={`badge${
                        r.status === 'READY' ? '' : r.status === 'FAILED' ? ' badge--dup-confirmed' : ' badge--muted'
                      }`}
                    >
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td>{formatPlDate(r.validUntil)}</td>
                  <td>
                    <button type="button" className="btn btn--sm btn--link" onClick={() => void openDetail(r.id)}>
                      Szczegóły
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <p className="workspace-panel__muted">Brak umów — dodaj pierwszą z aparatu lub z pliku.</p>
        )}
      </div>

      {detail && (
        <div className="modal-overlay" ref={overlayRef} onClick={onOverlayClick}>
          <div className="modal-content" role="dialog" aria-label="Szczegóły umowy">
            <div className="modal-header">
              <div>
                <h2 className="detail-panel__title">Umowa</h2>
                <p className="detail-panel__id mono">{detail.id}</p>
              </div>
              <button type="button" className="modal-close" onClick={closeDetail} aria-label="Zamknij">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div className="modal-body">
              <AgreementDetailForm
                detail={detail}
                contractors={contractors}
                onSaved={(d) => {
                  setDetail(d)
                  void loadList()
                }}
                onOpenFile={() => void onOpenFile()}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AgreementDetailForm({
  detail,
  contractors,
  onSaved,
  onOpenFile,
}: {
  detail: AgreementDetail
  contractors: ContractorDto[]
  onSaved: (d: AgreementDetail) => void
  onOpenFile: () => void
}) {
  const [title, setTitle] = useState(detail.title)
  const [subject, setSubject] = useState(detail.subject ?? '')
  const [counterpartyName, setCounterpartyName] = useState(detail.counterpartyName ?? '')
  const [counterpartyNip, setCounterpartyNip] = useState(detail.counterpartyNip ?? '')
  const [signedAt, setSignedAt] = useState(toYmd(detail.signedAt))
  const [validUntil, setValidUntil] = useState(toYmd(detail.validUntil))
  const [notes, setNotes] = useState(detail.notes ?? '')
  const [contractorId, setContractorId] = useState(detail.contractorId ?? '')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  useEffect(() => {
    setTitle(detail.title)
    setSubject(detail.subject ?? '')
    setCounterpartyName(detail.counterpartyName ?? '')
    setCounterpartyNip(detail.counterpartyNip ?? '')
    setSignedAt(toYmd(detail.signedAt))
    setValidUntil(toYmd(detail.validUntil))
    setNotes(detail.notes ?? '')
    setContractorId(detail.contractorId ?? '')
  }, [detail])

  const save = async () => {
    setSaveErr(null)
    setSaving(true)
    try {
      const body = {
        title: title.trim() || detail.title,
        subject: subject.trim() || null,
        counterpartyName: counterpartyName.trim() || null,
        counterpartyNip: counterpartyNip.trim() || null,
        signedAt: signedAt.trim() ? signedAt.trim() : null,
        validUntil: validUntil.trim() ? validUntil.trim() : null,
        notes: notes.trim() || null,
        contractorId: contractorId ? contractorId : null,
      }
      const next = await patchAgreement(detail.id, body)
      onSaved(next)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Zapis nie powiódł się.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-grid">
      <div className="modal-grid__left">
        <section className="detail-section">
          <h3>Plik</h3>
          <p className="workspace-panel__muted" style={{ marginBottom: 12 }}>
            Typ: {detail.primaryDoc.mimeType}
          </p>
          <button type="button" className="upload-bar__btn upload-bar__btn--file" onClick={onOpenFile}>
            Otwórz dokument
          </button>
        </section>
      </div>
      <div className="modal-grid__right">
        <section className="detail-section">
          <h3>Dane umowy</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <label className="field">
              <span className="field__label">Tytuł</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Przedmiot</span>
              <textarea className="textarea" rows={3} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Druga strona (nazwa)</span>
              <input className="input" value={counterpartyName} onChange={(e) => setCounterpartyName(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">NIP kontrahenta</span>
              <input className="input mono" value={counterpartyNip} onChange={(e) => setCounterpartyNip(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Powiązany kontrahent (księgowy)</span>
              <select className="input" value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
                <option value="">— brak —</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.nip}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label className="field" style={{ flex: 1, minWidth: 140 }}>
                <span className="field__label">Data podpisania</span>
                <input type="date" className="input" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} />
              </label>
              <label className="field" style={{ flex: 1, minWidth: 140 }}>
                <span className="field__label">Ważna do</span>
                <input type="date" className="input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span className="field__label">Notatki</span>
              <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          {saveErr && <p style={{ color: 'var(--danger, #c0392b)', marginTop: 8 }}>{saveErr}</p>}
          <div style={{ marginTop: 16 }}>
            <button type="button" className="upload-bar__btn upload-bar__btn--camera" disabled={saving} onClick={() => void save()}>
              {saving ? 'Zapisywanie…' : 'Zapisz zmiany'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
