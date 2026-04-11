type Ledger = 'purchase' | 'sale'

export function InvoiceLedgerTabs({
  value,
  onChange,
}: {
  value: Ledger
  onChange: (v: Ledger) => void
}) {
  return (
    <div className="doc-tabs invoice-ledger-tabs" role="tablist" aria-label="Rejestr faktur">
      <button
        type="button"
        role="tab"
        aria-selected={value === 'purchase'}
        className={`doc-tabs__btn${value === 'purchase' ? ' doc-tabs__btn--on' : ''}`}
        onClick={() => onChange('purchase')}
      >
        Kosztowe
        <span className="doc-tabs__hint">zakupy</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'sale'}
        className={`doc-tabs__btn${value === 'sale' ? ' doc-tabs__btn--on' : ''}`}
        onClick={() => onChange('sale')}
      >
        Sprzedażowe
        <span className="doc-tabs__hint">KSeF</span>
      </button>
    </div>
  )
}
