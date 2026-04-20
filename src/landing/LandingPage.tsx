import { useEffect } from 'react'
import './landing.css'

type LandingPageProps = {
  onNavigateAuth: (target: 'login' | 'register') => void
  onNavigateLegal: (target: 'terms' | 'privacy') => void
}

export default function LandingPage({ onNavigateAuth, onNavigateLegal }: LandingPageProps) {
  const supportEmail =
    typeof import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL === 'string' && import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL.trim()
      ? import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL.trim()
      : 'kontakt@tuttopizza.pl'

  useEffect(() => {
    const starsEl = document.getElementById('landing-stars')
    if (starsEl && starsEl.childElementCount === 0) {
      for (let i = 0; i < 30; i += 1) {
        const star = document.createElement('span')
        star.className = 'landing-star'
        star.style.left = `${Math.random() * 100}%`
        star.style.top = `${Math.random() * 100}%`
        star.style.animationDuration = `${6 + Math.random() * 10}s`
        star.style.animationDelay = `${-Math.random() * 10}s`
        starsEl.appendChild(star)
      }
    }

    const heroEl = document.querySelector<HTMLElement>('.landing-hero')
    const onScroll = () => {
      if (!heroEl) return
      const isPastHero = window.scrollY > heroEl.offsetHeight - 80
      document.body.classList.toggle('landing-past-hero', isPastHero)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12 },
    )
    document.querySelectorAll('.landing-reveal').forEach((el) => observer.observe(el))

    return () => {
      window.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [])

  return (
    <div className="landing-page">
      <nav className="landing-nav">
        <a className="landing-nav__brand" href="#top">
          <span className="landing-nav__mark">FV</span>
          <span className="landing-nav__name">FVControl</span>
        </a>
        <ul className="landing-nav__links">
          <li>
            <a href="#benefits">Funkcje</a>
          </li>
          <li>
            <a href="#how">Jak to działa</a>
          </li>
          <li>
            <a href="#pricing">Cennik</a>
          </li>
        </ul>
        <div className="landing-nav__actions">
          <button type="button" className="landing-btn landing-btn--ghost" onClick={() => onNavigateAuth('login')}>
            Zaloguj się
          </button>
          <button type="button" className="landing-btn landing-btn--primary" onClick={() => onNavigateAuth('register')}>
            Załóż konto
          </button>
        </div>
      </nav>

      <main id="top">
        <section className="landing-hero" aria-labelledby="landing-hero-title">
          <div className="landing-hero__bg" />
          <div className="landing-hero__grid" />
          <div className="landing-hero__stars" id="landing-stars" />
          <div className="landing-container landing-hero__inner">
            <div className="landing-hero__copy">
              <p className="landing-hero__kicker">Zintegrowane z KSeF · Live sync</p>
              <h1 id="landing-hero-title">
                Pełna kontrola <span>faktur i finansów</span> Twojej firmy
              </h1>
              <p>
                Automatyzuj obieg faktur, pilnuj terminów płatności i utrzymuj porządek w dokumentach. Jeden panel -
                cały obraz finansów.
              </p>
              <div className="landing-hero__actions">
                <button type="button" className="landing-btn landing-btn--primary" onClick={() => onNavigateAuth('register')}>
                  Załóż konto - bezpłatnie
                </button>
                <button type="button" className="landing-btn landing-btn--secondary" onClick={() => onNavigateAuth('login')}>
                  Zaloguj się
                </button>
              </div>
              <ul className="landing-trust-bar">
                <li>Bezpieczne dane</li>
                <li>Szybkie wdrożenie</li>
                <li>Wsparcie dla MŚP</li>
              </ul>
            </div>
            <div className="landing-hero__visual" aria-hidden>
              <div className="landing-device">
                <div className="landing-device__top" />
                <div className="landing-device__body">
                  <p className="landing-device__label">Przychody · kwiecień 2026</p>
                  <p className="landing-device__amount">896 120 zł</p>
                  <p className="landing-device__trend">+12,4% vs. marzec</p>
                  <ul className="landing-device__rows">
                    <li>
                      <span>Orange Polska</span>
                      <strong>1 245,00 zł</strong>
                    </li>
                    <li>
                      <span>Tauron Sprzedaż</span>
                      <strong>3 892,40 zł</strong>
                    </li>
                    <li>
                      <span>IKEA Retail</span>
                      <strong>4 120,00 zł</strong>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section landing-reveal" id="benefits">
          <div className="landing-container">
            <p className="landing-section__label">Kluczowe korzyści</p>
            <h2>Wszystko, czego potrzebujesz do kontroli faktur</h2>
            <p className="landing-section__lead">Jeden panel zamiast rozproszonych arkuszy, maili i teczek z dokumentami.</p>
            <div className="landing-grid landing-grid--cards">
              <article className="landing-card">
                <h3>Kontrola należności i zobowiązań</h3>
                <p>Pełny obraz płatności przychodzących i wychodzących w jednym miejscu.</p>
              </article>
              <article className="landing-card">
                <h3>Monitoring terminów płatności</h3>
                <p>System pilnuje terminów i pomaga unikać opóźnień.</p>
              </article>
              <article className="landing-card">
                <h3>Centralna baza faktur i kontrahentów</h3>
                <p>Dokumenty i dane partnerów zawsze pod ręką i łatwe do wyszukania.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="landing-section landing-section--alt landing-reveal" id="how">
          <div className="landing-container">
            <p className="landing-section__label">Jak to działa</p>
            <h2>Gotowy do pracy w kilka minut</h2>
            <div className="landing-steps">
              <article>
                <span>01</span>
                <h3>Załóż konto</h3>
                <p>E-mail i hasło lub Google. Uzupełnij NIP firmy i zacznij pracę.</p>
              </article>
              <article>
                <span>02</span>
                <h3>Połącz KSeF</h3>
                <p>Wklej token, PIN i opcjonalnie certyfikat. Synchronizacja rusza automatycznie.</p>
              </article>
              <article>
                <span>03</span>
                <h3>Kontroluj i płać</h3>
                <p>Śledź statusy, pilnuj terminów i eksportuj dane do księgowości.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="landing-section landing-reveal" id="pricing">
          <div className="landing-container">
            <p className="landing-section__label">Cennik</p>
            <h2>Prosty, przejrzysty model</h2>
            <div className="landing-grid landing-grid--plans">
              <article className="landing-plan">
                <h3>Free</h3>
                <p className="landing-plan__price">0 zł</p>
                <ul>
                  <li>Do 15 dokumentów łącznie</li>
                  <li>Integracja KSeF (własne poświadczenia MF)</li>
                  <li>Logowanie e-mailem lub Google</li>
                </ul>
              </article>
              <article className="landing-plan landing-plan--pro">
                <h3>PRO</h3>
                <p className="landing-plan__price">59 zł / mies.</p>
                <ul>
                  <li>Bez limitu dokumentów</li>
                  <li>Płatność kartą, Google Pay, Apple Pay</li>
                  <li>Zarządzanie subskrypcją w aplikacji</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className="landing-section landing-section--cta landing-reveal">
          <div className="landing-container">
            <h2>Uporządkuj finanse firmy i odzyskaj kontrolę</h2>
            <p>Dołącz do firm, które przestały szukać faktur w mailach i arkuszach.</p>
            <div className="landing-hero__actions">
              <button type="button" className="landing-btn landing-btn--primary" onClick={() => onNavigateAuth('register')}>
                Załóż konto - bezpłatnie
              </button>
              <button type="button" className="landing-btn landing-btn--secondary" onClick={() => onNavigateAuth('login')}>
                Zaloguj się
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer__inner">
          <nav className="landing-footer__links" aria-label="Linki informacyjne">
            <button type="button" className="landing-footer__linkbtn" onClick={() => onNavigateLegal('privacy')}>
              Polityka prywatności
            </button>
            <button type="button" className="landing-footer__linkbtn" onClick={() => onNavigateLegal('terms')}>
              Regulamin
            </button>
            <a href={`mailto:${supportEmail}`}>Kontakt</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
