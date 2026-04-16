import './legal.css'

type Kind = 'terms' | 'privacy'

const titles: Record<Kind, string> = {
  terms: 'Regulamin świadczenia usług',
  privacy: 'Polityka prywatności',
}

const leads: Record<Kind, string> = {
  terms:
    'Poniżej znajduje się szablon do uzupełnienia przez usługodawcę przed uruchomieniem publicznej sprzedaży subskrypcji.',
  privacy:
    'Opis zasad przetwarzania danych osobowych (RODO) należy dostosować do faktycznego działania serwisu i uzupełnić przed startem sprzedaży.',
}

export function PlaceholderLegalPage(props: { kind: Kind; onBack: () => void }) {
  const { kind, onBack } = props
  return (
    <div className="legal-page">
      <header className="legal-page__head">
        <button type="button" className="legal-page__back" onClick={onBack}>
          Wróć
        </button>
        <h1>{titles[kind]}</h1>
        <p className="legal-page__lead">{leads[kind]}</p>
      </header>
      <main className="legal-page__body">
        <ol className="legal-page__list">
          <li>Identyfikacja usługodawcy (nazwa, adres, NIP, KRS jeśli dotyczy).</li>
          <li>Przedmiot usługi (dostęp do aplikacji SaaS), okres rozliczeniowy, cennik.</li>
          <li>Płatności i rozliczenia (np. Stripe), prawo odstąpienia jeśli dotyczy konsumentów.</li>
          <li>Odpowiedzialność, SLA jeśli oferujecie, kontakt do supportu.</li>
          <li>Postanowienia dotyczące danych KSeF i integracji z Ministerstwem Finansów.</li>
          <li>Prawo właściwe i sposób rozstrzygania sporów.</li>
        </ol>
        {kind === 'privacy' && (
          <ul className="legal-page__list">
            <li>Administrator danych, cele i podstawy prawne przetwarzania.</li>
            <li>Okres przechowywania, prawa osoby, której dane dotyczą.</li>
            <li>Procesory (hosting, Stripe, e-mail transakcyjny) i transfer poza EOG jeśli występuje.</li>
          </ul>
        )}
      </main>
    </div>
  )
}
