import { useEffect } from 'react'
import './landing.css'

type LandingPageProps = {
  onNavigateAuth: (target: 'login' | 'register') => void
  onNavigateLegal: (target: 'terms' | 'privacy') => void
  onNavigatePricing: () => void
}

export default function LandingPage({ onNavigateAuth, onNavigateLegal, onNavigatePricing }: LandingPageProps) {
  const supportEmail =
    typeof import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL === 'string' && import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL.trim()
      ? import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL.trim()
      : 'kontakt@tuttopizza.pl'

  useEffect(() => {
    document.body.classList.add('hero-dark')
    const timers: number[] = []
    const starsEl = document.getElementById('stars')
    if (starsEl) {
      starsEl.innerHTML = ''
      for (let i = 0; i < 40; i += 1) {
        const star = document.createElement('span')
        star.className = `star${Math.random() > 0.7 ? ' lg' : ''}`
        star.style.left = `${Math.random() * 100}%`
        star.style.top = `${Math.random() * 100}%`
        star.style.animationDuration = `${6 + Math.random() * 10}s`
        star.style.animationDelay = `${-Math.random() * 10}s`
        starsEl.appendChild(star)
      }
    }

    const amountEl = document.getElementById('live-amount')
    const sparkEl = document.getElementById('fw-spark-val')
    let amount = 98420
    let spark = 42810
    timers.push(
      window.setInterval(() => {
        amount += Math.floor(Math.random() * 40) + 8
        spark += Math.floor(Math.random() * 80) + 20
        if (amountEl) amountEl.textContent = `${amount.toLocaleString('pl-PL')} zł`
        if (sparkEl) sparkEl.textContent = `${spark.toLocaleString('pl-PL')} zł`
      }, 2600),
    )

    const calGrid = document.getElementById('cal-grid')
    if (calGrid) {
      calGrid.innerHTML = ''
      const todayIdx = 14
      const levels = [0, 0, 1, 0, 2, 0, 0, 0, 1, 0, 0, 3, 1, 0, 0, 0, 2, 0, 1, 0, 0, 0, 3, 0, 1, 0, 0, 2, 0, 1, 0]
      for (let i = 1; i <= 30; i += 1) {
        const cell = document.createElement('div')
        const lvl = levels[i - 1] || 0
        cell.className = `cal-cell${lvl ? ` lvl-${lvl}` : ''}${i === todayIdx ? ' today' : ''}`
        cell.textContent = String(i)
        calGrid.appendChild(cell)
      }
    }

    const toastTitle = document.getElementById('toast-title')
    const toastMeta = document.getElementById('toast-meta')
    const toastData = [
      ['Nowa faktura · Orange', 'FV/2026/04/0183 · 1 245,00 zł'],
      ['Zapłacono · Tauron', 'TS/04/18742 · 3 892,40 zł'],
      ['KSeF sync ✓', '3 dokumenty pobrane'],
      ['Nowa faktura · IKEA', 'IKE-04-2288 · 4 120,00 zł'],
    ]
    let tIdx = 0
    timers.push(
      window.setInterval(() => {
        tIdx = (tIdx + 1) % toastData.length
        if (toastTitle) toastTitle.textContent = toastData[tIdx][0]
        if (toastMeta) toastMeta.textContent = toastData[tIdx][1]
      }, 4000),
    )

    const ksefText = document.getElementById('ksef-txt')
    const ksefLines = ['Pobrano 3 nowe dokumenty', 'Weryfikacja FV/04/0183...', 'Synchronizacja z MF ✓', 'Monitoring KSeF aktywny']
    let kIdx = 0
    timers.push(
      window.setInterval(() => {
        kIdx = (kIdx + 1) % ksefLines.length
        if (ksefText) ksefText.textContent = ksefLines[kIdx]
      }, 2000),
    )

    const heroEl = document.querySelector<HTMLElement>('.hero')
    const onScroll = () => {
      const y = window.scrollY
      if (heroEl) {
        const past = y > heroEl.offsetHeight - 80
        document.body.classList.toggle('past-hero', past)
      }
      document.body.classList.toggle('nav-top', y < 12)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12 },
    )
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el))

    return () => {
      timers.forEach((id) => window.clearInterval(id))
      window.removeEventListener('scroll', onScroll)
      observer.disconnect()
      document.body.classList.remove('hero-dark', 'past-hero', 'nav-top')
    }
  }, [])

  return (
    <div className="landing-page">
      <nav className="nav">
        <a className="nav__brand" href="#">
          <div className="nav__mark">
            <svg viewBox="0 0 26 26" fill="none" aria-hidden>
              <rect x="4" y="3" width="13" height="17" rx="2.5" fill="rgba(255,255,255,0.22)" />
              <rect x="4" y="3" width="13" height="17" rx="2.5" stroke="white" strokeWidth="1.5" />
              <line x1="7" y1="9" x2="14" y2="9" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="7" y1="12" x2="14" y2="12" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="7" y1="15" x2="11" y2="15" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
              <circle cx="19" cy="18" r="4.5" fill="#a855f7" />
              <polyline points="16.5,18 18.2,19.8 21.5,16.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
          <span className="nav__name">
            FV<span>Control</span>
          </span>
        </a>
        <ul className="nav__links">
          <li><a href="#benefits">Funkcje</a></li>
          <li><a href="#how">Jak to działa</a></li>
          <li><a href="#pricing">Cennik</a></li>
        </ul>
        <div className="nav__cta">
          <button type="button" className="btn-ghost-nav" onClick={() => onNavigateAuth('login')}>
            Zaloguj się
          </button>
          <button type="button" className="btn-primary-nav" onClick={() => onNavigateAuth('register')}>
            Załóż konto
          </button>
        </div>
      </nav>

      <main>
        <section className="hero">
          <div className="hero__bg">
            <div className="hero__bg-blob-3" />
          </div>
          <div className="hero__grid" />
          <div className="hero__stars" id="stars" />

          <div className="hero__inner">
            <div className="hero__copy">
              <div className="hero__kicker">
                <span className="kicker-dot" />
                Zintegrowane z KSeF · Live sync
              </div>
              <h1 className="hero__h1">
                Pełna kontrola<br />
                <span className="grad">faktur i finansów</span>
                <br />
                Twojej firmy
              </h1>
              <p className="hero__lead">Automatyzuj obieg faktur, pilnuj terminów płatności i utrzymuj porządek w dokumentach. Jeden panel — cały obraz finansów.</p>
              <div className="hero__actions">
                <button type="button" className="btn-primary-hero" onClick={() => onNavigateAuth('register')}>
                  Załóż konto — bezpłatnie
                </button>
                <button type="button" className="btn-ghost-hero" onClick={() => onNavigateAuth('login')}>
                  Zaloguj się
                </button>
              </div>
              <ul className="trust-bar">
                <li className="trust-chip">Bezpieczne dane</li>
                <li className="trust-chip">Szybkie wdrożenie</li>
                <li className="trust-chip">Wsparcie dla MŚP</li>
              </ul>
            </div>

            <div className="hero__visual">
              <div className="device-glow" />
              <div className="pulse-ring" />
              <div className="pulse-ring r2" />
              <div className="pulse-ring r3" />
              <svg className="flow-lines" viewBox="0 0 560 560" preserveAspectRatio="xMidYMid meet" aria-hidden>
                <defs>
                  <linearGradient id="flowGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="rgba(79,110,247,0)" />
                    <stop offset="45%" stopColor="rgba(79,110,247,0.9)" />
                    <stop offset="55%" stopColor="rgba(168,85,247,0.9)" />
                    <stop offset="100%" stopColor="rgba(168,85,247,0)" />
                  </linearGradient>
                  <filter id="flowGlow">
                    <feGaussianBlur stdDeviation="2.5" />
                  </filter>
                </defs>
                <path d="M 75 100 C 140 140, 200 200, 230 240" fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="1.2" />
                <path d="M 485 100 C 420 140, 360 200, 330 240" fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="1.2" />
                <path d="M 75 460 C 140 420, 200 360, 230 320" fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="1.2" />
                <path d="M 485 460 C 420 420, 360 360, 330 320" fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="1.2" />
                <path className="flow-dash f1" d="M 75 100 C 140 140, 200 200, 230 240" fill="none" stroke="url(#flowGrad)" strokeWidth="1.6" strokeLinecap="round" filter="url(#flowGlow)" />
                <path className="flow-dash f2" d="M 485 100 C 420 140, 360 200, 330 240" fill="none" stroke="url(#flowGrad)" strokeWidth="1.6" strokeLinecap="round" filter="url(#flowGlow)" />
                <path className="flow-dash f3" d="M 75 460 C 140 420, 200 360, 230 320" fill="none" stroke="url(#flowGrad)" strokeWidth="1.6" strokeLinecap="round" filter="url(#flowGlow)" />
                <path className="flow-dash f4" d="M 485 460 C 420 420, 360 360, 330 320" fill="none" stroke="url(#flowGrad)" strokeWidth="1.6" strokeLinecap="round" filter="url(#flowGlow)" />
              </svg>

              <div className="fw fw--donut" style={{ top: '3%', left: 0 }}>
                <div className="fw__label">Status płatności</div>
                <div className="fw__donut-wrap">
                  <svg viewBox="0 0 44 44" className="fw__donut" aria-hidden>
                    <circle cx="22" cy="22" r="17" stroke="rgba(148,163,184,0.15)" strokeWidth="5" fill="none" />
                    <circle className="donut-seg s1" cx="22" cy="22" r="17" stroke="#4ade80" strokeWidth="5" fill="none" strokeDasharray="62 107" strokeDashoffset="0" transform="rotate(-90 22 22)" strokeLinecap="round" />
                    <circle className="donut-seg s2" cx="22" cy="22" r="17" stroke="#fbbf24" strokeWidth="5" fill="none" strokeDasharray="28 107" strokeDashoffset="-62" transform="rotate(-90 22 22)" strokeLinecap="round" />
                    <circle className="donut-seg s3" cx="22" cy="22" r="17" stroke="#a78bfa" strokeWidth="5" fill="none" strokeDasharray="17 107" strokeDashoffset="-90" transform="rotate(-90 22 22)" strokeLinecap="round" />
                  </svg>
                  <div className="fw__donut-center">
                    <span className="fw__donut-num">58</span>
                    <span className="fw__donut-unit">%</span>
                  </div>
                </div>
              </div>

              <div className="fw fw--spark" style={{ top: '3%', right: 0 }}>
                <div className="fw__spark-head">
                  <span className="fw__label">Przepływy · 30d</span>
                  <span className="fw__delta">+12,4%</span>
                </div>
                <div className="fw__val" id="fw-spark-val">
                  42 810 zł
                </div>
              </div>

              <div className="fw fw--toast" id="toast">
                <div className="toast__body">
                  <div className="toast__title" id="toast-title">Nowa faktura · Orange</div>
                  <div className="toast__meta" id="toast-meta">FV/2026/04/0183 · 1 245,00 zł</div>
                </div>
              </div>

              <div className="fw fw--cal" style={{ bottom: '3%', left: 0 }}>
                <div className="fw__cal-head">
                  <span className="fw__label">Terminy · kwiecień</span>
                </div>
                <div className="fw__cal-grid" id="cal-grid" />
              </div>

              <div className="fw fw--ksef" style={{ bottom: '3%', right: 0 }}>
                <div className="fw__label">KSeF · Live sync</div>
                <div className="ksef-feed">
                  <span className="ksef-dot" />
                  <span className="ksef-txt" id="ksef-txt">
                    Pobrano 3 nowe dokumenty
                  </span>
                </div>
              </div>

              <div className="device">
                <div className="device__frame">
                  <div className="device__bar">
                    <div className="device__dot" />
                    <div className="device__dot" />
                    <div className="device__dot" />
                    <span className="device__title">fvcontrol · live</span>
                  </div>
                  <div className="device__body">
                    <div className="device__eyebrow">Przychody · kwiecień 2026</div>
                    <div className="device__amount" id="live-amount">
                      98 420 zł
                    </div>
                    <div className="device__trend">+ 12,4 % <span>vs. marzec</span></div>
                    <div className="device__chart">
                      <svg className="chart-svg" viewBox="0 0 240 64" preserveAspectRatio="none" aria-hidden>
                        <defs>
                          <linearGradient id="chartGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#4f6ef7" />
                            <stop offset="100%" stopColor="#a855f7" />
                          </linearGradient>
                          <linearGradient id="chartFillGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#4f6ef7" stopOpacity="0.45" />
                            <stop offset="100%" stopColor="#4f6ef7" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <path className="chart-fill" d="M0,64 L0,48 C20,48 40,40 60,32 S100,42 120,40 S160,22 180,22 S220,30 240,28 L240,64 Z" />
                        <path className="chart-line" d="M0,48 C20,48 40,40 60,32 S100,42 120,40 S160,22 180,22 S220,30 240,28" />
                        <circle className="chart-dot" cx="20" cy="48" r="3.5" />
                      </svg>
                    </div>
                    <div className="device__rows">
                      <div className="device__row">
                        <div className="device__row-left">
                          <span className="device__row-vendor">Orange Polska</span>
                          <span className="device__row-meta">FV/2025/04/0183 · KSeF</span>
                        </div>
                        <div className="device__row-right">
                          <span className="device__row-amt">1 245,00 zł</span>
                          <span className="device__row-badge b-paid">PAID</span>
                        </div>
                      </div>
                      <div className="device__row">
                        <div className="device__row-left">
                          <span className="device__row-vendor">Tauron Sprzedaż</span>
                          <span className="device__row-meta">TS/04/18742</span>
                        </div>
                        <div className="device__row-right">
                          <span className="device__row-amt">3 892,40 zł</span>
                          <span className="device__row-badge b-pending">DUE</span>
                        </div>
                      </div>
                      <div className="device__row">
                        <div className="device__row-left">
                          <span className="device__row-vendor">IKEA Retail</span>
                          <span className="device__row-meta">IKE-04-2288</span>
                        </div>
                        <div className="device__row-right">
                          <span className="device__row-amt">4 120,00 zł</span>
                          <span className="device__row-badge b-ksef">SYNC</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="benefits reveal" id="benefits">
          <div className="section-inner">
            <div className="section-label">Kluczowe korzyści</div>
            <h2 className="section-h2">Wszystko, czego potrzebujesz do kontroli faktur</h2>
            <p className="section-lead">Jeden panel zamiast rozproszonych arkuszy, maili i teczek z dokumentami.</p>
            <div className="benefits-grid">
              <article className="benefit-card">
                <h3>Kontrola należności i zobowiązań</h3>
                <p>Pełny obraz płatności przychodzących i wychodzących w jednym miejscu — bez zgadywania stanu konta.</p>
              </article>
              <article className="benefit-card">
                <h3>Monitoring terminów płatności</h3>
                <p>System pilnuje zbliżających się terminów — reagujesz szybciej i unikasz kosztownych opóźnień.</p>
              </article>
              <article className="benefit-card">
                <h3>Centralna baza faktur i kontrahentów</h3>
                <p>Dokumenty i dane partnerów zawsze pod ręką — posortowane, otagowane, gotowe do wyszukania w sekundy.</p>
              </article>
              <article className="benefit-card">
                <h3>Raporty kosztów i przychodów</h3>
                <p>Szybka ocena rentowności i podejmowanie decyzji na podstawie aktualnych, rzetelnych danych.</p>
              </article>
              <article className="benefit-card">
                <h3>Mniej pracy ręcznej, mniej błędów</h3>
                <p>Automatyczne pobieranie z KSeF, deduplikacja i kategoryzacja — zamiast przeklejania danych ręcznie.</p>
              </article>
              <article className="benefit-card">
                <h3>Lepsza płynność finansowa</h3>
                <p>Stały monitoring salda i zaległości przekłada się na stabilny cash flow i większy spokój operacyjny.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="how reveal" id="how">
          <div className="section-inner">
            <div className="section-label">Jak to działa</div>
            <h2 className="section-h2">Gotowy do pracy w kilka minut</h2>
            <p className="section-lead">Bez instalacji, bez integratorów, bez tygodni wdrożenia.</p>
            <div className="steps">
              <article className="step">
                <div className="step__num">01</div>
                <h3>Załóż konto</h3>
                <p>E-mail i hasło lub Google. Uzupełnij NIP firmy w ustawieniach — to wszystko, żeby zacząć.</p>
                <span className="step__tag">Bezpłatnie</span>
              </article>
              <article className="step">
                <div className="step__num">02</div>
                <h3>Połącz KSeF</h3>
                <p>W Ustawieniach wklej token z portalu Ministerstwa Finansów, PIN oraz opcjonalnie certyfikat.</p>
                <span className="step__tag">Pełna synchronizacja</span>
              </article>
              <article className="step">
                <div className="step__num">03</div>
                <h3>Kontroluj i płać</h3>
                <p>Kategoryzuj, zatwierdzaj i śledź statusy płatności. Raporty, eksport do księgowości i cash flow.</p>
                <span className="step__tag">Zero chaosu</span>
              </article>
            </div>
          </div>
        </section>

        <section className="pricing reveal" id="pricing">
          <div className="section-inner">
            <div className="section-label">Cennik</div>
            <h2 className="section-h2">Prosty, przejrzysty model</h2>
            <p className="section-lead">Limit na planie Free obejmuje faktury i umowy łącznie. Subskrypcja PRO jest rozliczana w aplikacji.</p>
            <div className="plans">
              <article className="plan">
                <div className="plan__name">Free</div>
                <div className="plan__price">0 zł</div>
                <ul>
                  <li>Do 15 dokumentów łącznie</li>
                  <li>Integracja KSeF (własne poświadczenia MF)</li>
                  <li>Logowanie e-mailem lub Google</li>
                </ul>
                <button type="button" className="btn-plan btn-plan--outline" onClick={() => onNavigateAuth('register')}>
                  Zacznij bezpłatnie
                </button>
              </article>
              <article className="plan plan--pro">
                <div className="plan__badge">Polecany</div>
                <div className="plan__name">PRO</div>
                <div className="plan__price">
                  67 zł <span>/ mies.</span>
                </div>
                <ul>
                  <li>Bez limitu dokumentów</li>
                  <li>Karta · BLIK · Przelewy24</li>
                  <li>Stripe Customer Portal — zarządzanie subskrypcją</li>
                  <li>Faktura VAT (KSeF) za subskrypcję</li>
                </ul>
                <button type="button" className="btn-plan btn-plan--solid" onClick={() => onNavigateAuth('register')}>
                  Wybierz PRO
                </button>
              </article>
            </div>
            <div className="pricing__cta-row">
              <button type="button" className="btn-link" onClick={onNavigatePricing}>
                Zobacz pełny cennik — FAQ + porównanie z Fakturownia/InFakt →
              </button>
            </div>
          </div>
        </section>

        <section className="cta-section reveal">
          <div className="section-inner">
            <h2 className="cta-h2">Uporządkuj finanse firmy i odzyskaj kontrolę</h2>
            <p className="cta-lead">Dołącz do firm, które przestały szukać faktur w mailach i arkuszach kalkulacyjnych.</p>
            <div className="cta-actions">
              <button type="button" className="btn-primary-hero" onClick={() => onNavigateAuth('register')}>
                Załóż konto — bezpłatnie
              </button>
              <button type="button" className="btn-ghost-hero" onClick={() => onNavigateAuth('login')}>
                Zaloguj się
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="footer-inner">
          <a className="footer-brand" href="#">
            FV<span>Control</span>
          </a>
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
