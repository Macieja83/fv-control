import { useState } from 'react'
import './landing.css'
import './pricing.css'

type PricingPageProps = {
  onNavigateAuth: (target: 'login' | 'register') => void
  onNavigateLegal: (target: 'terms' | 'privacy') => void
  onNavigateHome: () => void
}

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Czy plan Free wystarczy mi na start?',
    a: 'Tak — Free obejmuje do 15 dokumentów łącznie (faktury + umowy). To wystarczy żeby zobaczyć jak działa integracja KSeF, sprawdzić deduplikację, terminy płatności i raporty. Po przekroczeniu limitu możesz przejść na PRO w dowolnym momencie.',
  },
  {
    q: 'Czy mogę zrezygnować w trakcie miesiąca?',
    a: 'W MVP PRO jest opłacany jednorazowo na 30 dni przez BLIK albo Przelewy24. Nie ma automatycznego odnowienia — po końcu okresu możesz opłacić kolejny miesiąc.',
  },
  {
    q: 'Jakie metody płatności obsługujecie?',
    a: 'Plan PRO w MVP przyjmuje BLIK oraz Przelewy24 jako jednorazową płatność za 30 dni dostępu. Płatności obsługuje Stripe — PCI-DSS Level 1.',
  },
  {
    q: 'Czy dostanę fakturę VAT za subskrypcję?',
    a: 'Tak, automatycznie. Po opłaceniu wystawiamy fakturę VAT 23% i wysyłamy ją w KSeF (Krajowy System eFaktur) zgodnie z prawem. Otrzymujesz też kopię emailem z linkiem do podglądu w panelu „Moje faktury kosztowe".',
  },
  {
    q: 'Czy mogę wyeksportować swoje dane?',
    a: 'Tak — pełny eksport (faktury PDF + JSON z metadanymi) dostępny jest w ustawieniach. To Twoje prawo zgodnie z RODO art. 20 (przenoszenie danych). Eksport możesz pobrać kiedy chcesz, również po anulowaniu subskrypcji (30 dni grace period przed permanentnym usunięciem).',
  },
  {
    q: 'Czy integrujecie się z księgowymi i biurami rachunkowymi?',
    a: 'Tak. Twój księgowy może dostać własne konto z dostępem read-only do Twoich faktur — bez płacenia osobnej subskrypcji. Eksport CSV/JSON dla Comarch Optima, enova365, Sage Symfonia, InsERT Subiekt jest na roadmapie (priorytet zależy od głosów klientów).',
  },
  {
    q: 'Co z deadlinem KSeF 2026?',
    a: 'KSeF jest obowiązkowy od lutego 2026 dla większości firm. FV Control automatycznie pobiera faktury z KSeF oraz wystawia faktury wychodzące do KSeF — Twoja firma jest gotowa na deadline. Wymagamy tylko tokenu autoryzacyjnego z portalu Ministerstwa Finansów (5 min konfiguracji).',
  },
]

export default function PricingPage({ onNavigateAuth, onNavigateLegal, onNavigateHome }: PricingPageProps) {
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const supportEmail =
    typeof import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL === 'string' && import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL.trim()
      ? import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL.trim()
      : 'kontakt@tuttopizza.pl'

  return (
    <div className="pricing-page">
      <nav className="pricing-nav">
        <button
          type="button"
          className="pricing-nav__brand"
          onClick={onNavigateHome}
          aria-label="Wróć do strony głównej"
        >
          FV<span>Control</span>
        </button>
        <div className="pricing-nav__cta">
          <button type="button" className="btn-ghost-nav" onClick={() => onNavigateAuth('login')}>
            Zaloguj się
          </button>
          <button type="button" className="btn-primary-nav" onClick={() => onNavigateAuth('register')}>
            Załóż konto
          </button>
        </div>
      </nav>

      <main className="pricing-main">
        <section className="pricing-hero">
          <div className="pricing-hero__inner">
            <div className="section-label">Cennik</div>
            <h1 className="pricing-hero__h1">Prosty, przejrzysty, polski</h1>
            <p className="pricing-hero__lead">
              Plan Free do testów bez ograniczeń czasowych. PRO za 67 zł brutto miesięcznie — bez ukrytych kosztów,
              bez przedłużonych umów, faktura VAT w KSeF w cenie.
            </p>
          </div>
        </section>

        <section className="pricing-plans">
          <div className="section-inner">
            <div className="plans-grid">
              <article className="pricing-plan">
                <div className="pricing-plan__name">Free</div>
                <div className="pricing-plan__price">0 zł <span>/ zawsze</span></div>
                <p className="pricing-plan__lead">Idealny na początek — sprawdź jak działa integracja KSeF.</p>
                <ul className="pricing-plan__features">
                  <li>Do <strong>15 dokumentów</strong> łącznie (faktury + umowy)</li>
                  <li>Integracja KSeF (Twoje poświadczenia MF)</li>
                  <li>Logowanie email lub Google</li>
                  <li>Synchronizacja IMAP z Twojej skrzynki</li>
                  <li>Eksport CSV / JSON / PDF</li>
                  <li>Wsparcie email (czas odpowiedzi 2 dni robocze)</li>
                </ul>
                <button type="button" className="btn-plan btn-plan--outline" onClick={() => onNavigateAuth('register')}>
                  Zacznij bezpłatnie
                </button>
              </article>

              <article className="pricing-plan pricing-plan--pro">
                <div className="pricing-plan__badge">Polecany</div>
                <div className="pricing-plan__name">PRO</div>
                <div className="pricing-plan__price">67 zł <span>/ mies. brutto</span></div>
                <div className="pricing-plan__price-meta">54,47 zł netto + 12,53 zł VAT (23%)</div>
                <p className="pricing-plan__lead">Dla firm aktywnie wystawiających i odbierających faktury.</p>
                <ul className="pricing-plan__features">
                  <li><strong>Bez limitu</strong> dokumentów</li>
                  <li>BLIK · Przelewy24 (prepaid 30 dni)</li>
                  <li>Bez automatycznego odnowienia w MVP</li>
                  <li><strong>Faktura VAT (KSeF)</strong> za subskrypcję — automatycznie</li>
                  <li>Synchronizacja KSeF i IMAP w czasie rzeczywistym</li>
                  <li>Workflow + reguły deduplikacji</li>
                  <li>Konto dla księgowego (read-only) <em>bez doliczeń</em></li>
                  <li>Webhooki na faktury i statusy płatności</li>
                  <li>Wsparcie email + chat (czas odpowiedzi 1 dzień roboczy)</li>
                </ul>
                <button type="button" className="btn-plan btn-plan--solid" onClick={() => onNavigateAuth('register')}>
                  Wybierz PRO
                </button>
              </article>
            </div>

            <p className="pricing-plans__note">
              Wszystkie ceny brutto. MVP: jednorazowa płatność BLIK / Przelewy24 (dostęp na 30 dni).
              Płatności obsługuje Stripe (PCI-DSS Level 1).
            </p>
          </div>
        </section>

        <section className="pricing-compare">
          <div className="section-inner">
            <div className="section-label">Porównanie</div>
            <h2 className="section-h2">FV Control vs popularna konkurencja</h2>
            <p className="section-lead">
              Ceny i funkcje na poziomie planu zbliżonego do PRO (stan na 2026-05). Sprawdź dokładnie u dostawcy zanim
              zdecydujesz — promocje i tier wprowadzające zmieniają sytuację.
            </p>
            <div className="compare-table-wrap">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>Funkcja</th>
                    <th className="th-highlight">FV Control PRO</th>
                    <th>Fakturownia</th>
                    <th>InFakt</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Cena brutto / mies.</td>
                    <td className="td-highlight"><strong>67 zł</strong></td>
                    <td>~30 zł (Plus)</td>
                    <td>~35 zł (Faktura+)</td>
                  </tr>
                  <tr>
                    <td>Integracja KSeF (odbiór)</td>
                    <td className="td-highlight">✓ Native</td>
                    <td>✓ Dostępne</td>
                    <td>✓ Dostępne</td>
                  </tr>
                  <tr>
                    <td>Integracja KSeF (wysyłka)</td>
                    <td className="td-highlight">✓ Native, XAdES</td>
                    <td>✓ Dostępne</td>
                    <td>✓ Dostępne</td>
                  </tr>
                  <tr>
                    <td>Deduplikacja faktur</td>
                    <td className="td-highlight">✓ Workflow + ML rules</td>
                    <td>Częściowo (warianty)</td>
                    <td>—</td>
                  </tr>
                  <tr>
                    <td>IMAP intake (faktury z maila)</td>
                    <td className="td-highlight">✓ Automatyczna</td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                  <tr>
                    <td>Konto dla księgowego</td>
                    <td className="td-highlight">Bezpłatne (read-only)</td>
                    <td>Płatne osobno</td>
                    <td>Płatne osobno</td>
                  </tr>
                  <tr>
                    <td>API + webhooks</td>
                    <td className="td-highlight">✓ Publiczne OpenAPI</td>
                    <td>API dla wyższych planów</td>
                    <td>API podstawowe</td>
                  </tr>
                  <tr>
                    <td>Płatność BLIK / P24</td>
                    <td className="td-highlight">✓ BLIK + P24</td>
                    <td>Karta + przelew</td>
                    <td>Karta + przelew</td>
                  </tr>
                  <tr>
                    <td>RODO data export</td>
                    <td className="td-highlight">✓ One-click</td>
                    <td>Email request</td>
                    <td>Email request</td>
                  </tr>
                  <tr>
                    <td>Dane przechowywane w PL/EU</td>
                    <td className="td-highlight">✓ Tak (Hostinger PL)</td>
                    <td>✓ PL</td>
                    <td>✓ PL</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="compare-disclaimer">
              Porównanie informacyjne, na podstawie publicznych cenników z 2026-05. Konkurenci oferują też inne plany —
              jeśli ich tier wprowadzający spełnia Twoje potrzeby, może być tańszy. FV Control celuje w firmy, które
              potrzebują automatyzacji workflow + dostępu API + dedykowanego konta księgowego bez doliczeń.
            </p>
          </div>
        </section>

        <section className="pricing-faq">
          <div className="section-inner">
            <div className="section-label">FAQ</div>
            <h2 className="section-h2">Najczęstsze pytania</h2>
            <div className="faq-list">
              {FAQ.map((item, idx) => {
                const isOpen = openFaq === idx
                return (
                  <details
                    key={item.q}
                    className={`faq-item${isOpen ? ' faq-item--open' : ''}`}
                    open={isOpen}
                    onToggle={(e) => {
                      const el = e.currentTarget as HTMLDetailsElement
                      if (el.open && openFaq !== idx) setOpenFaq(idx)
                      if (!el.open && openFaq === idx) setOpenFaq(null)
                    }}
                  >
                    <summary>{item.q}</summary>
                    <p>{item.a}</p>
                  </details>
                )
              })}
            </div>
            <p className="faq-contact">
              Twoje pytanie nie jest na liście? Napisz: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
            </p>
          </div>
        </section>

        <section className="pricing-cta">
          <div className="section-inner">
            <h2 className="cta-h2">Załóż konto — sprawdź FV Control za darmo</h2>
            <p className="cta-lead">15 dokumentów na planie Free wystarczy żeby ocenić integrację KSeF i workflow.</p>
            <div className="cta-actions">
              <button type="button" className="btn-primary-hero" onClick={() => onNavigateAuth('register')}>
                Załóż konto — bezpłatnie
              </button>
              <button type="button" className="btn-ghost-hero" onClick={onNavigateHome}>
                Wróć do strony głównej
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="footer-inner">
          <button type="button" className="footer-brand" onClick={onNavigateHome}>
            FV<span>Control</span>
          </button>
          <nav className="footer-links" aria-label="Linki informacyjne">
            <button type="button" onClick={() => onNavigateLegal('privacy')}>
              Polityka prywatności
            </button>
            <button type="button" onClick={() => onNavigateLegal('terms')}>
              Regulamin
            </button>
            <a href="/docs" target="_blank" rel="noopener noreferrer">
              Dokumentacja API
            </a>
            <a href={`mailto:${supportEmail}`}>Kontakt</a>
          </nav>
          <span className="footer-copy">© 2026 FV Control. Dane chronione zgodnie z RODO.</span>
        </div>
      </footer>
    </div>
  )
}
