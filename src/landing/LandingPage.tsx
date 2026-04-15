import {
  benefits,
  features,
  stats,
  steps,
  testimonials,
  trustItems,
  type LandingFeature,
  type LandingStep,
} from './landingContent'
import './landing.css'

type LandingPageProps = {
  onNavigateAuth: (target: 'login' | 'register') => void
}

function FeatureCard({ icon, title, description }: LandingFeature) {
  return (
    <article className="landing-feature">
      <span className="landing-feature__icon" aria-hidden>
        {icon}
      </span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </article>
  )
}

function StepCard({ title, description }: LandingStep) {
  return (
    <li className="landing-step">
      <span className="landing-step__badge" aria-hidden />
      <div>
        <p>{title}</p>
        <small>{description}</small>
      </div>
    </li>
  )
}

export default function LandingPage({ onNavigateAuth }: LandingPageProps) {
  return (
    <div className="landing-page">
      <main id="main-content">
        <section className="landing-section landing-hero" aria-labelledby="landing-hero-title">
          <div className="landing-container">
            <p className="landing-kicker">Moje FV Control</p>
            <h1 id="landing-hero-title">Pełna kontrola faktur i finansów Twojej firmy</h1>
            <p className="landing-lead">
              Automatyzuj obieg faktur, pilnuj terminów płatności i utrzymuj porządek w dokumentach. Zarządzaj finansami
              firmy szybciej i pewniej, bez chaosu.
            </p>
            <div className="landing-hero__actions" role="group" aria-label="Akcje logowania i rejestracji">
              <button type="button" className="landing-btn landing-btn--primary" onClick={() => onNavigateAuth('register')}>
                Załóż konto
              </button>
              <button type="button" className="landing-btn landing-btn--secondary" onClick={() => onNavigateAuth('login')}>
                Zaloguj się
              </button>
            </div>
            <ul className="landing-trust-bar" aria-label="Najważniejsze przewagi">
              {trustItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="landing-benefits-title">
          <div className="landing-container">
            <h2 id="landing-benefits-title">Kluczowe korzyści dla firmy</h2>
            <div className="landing-grid landing-grid--cards">
              {benefits.map((benefit) => (
                <article key={benefit.title} className="landing-card">
                  <h3>{benefit.title}</h3>
                  <p>{benefit.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-section--tinted" aria-labelledby="landing-features-title">
          <div className="landing-container">
            <h2 id="landing-features-title">Funkcjonalności produktu</h2>
            <div className="landing-grid landing-grid--features">
              {features.map((feature) => (
                <FeatureCard key={feature.title} {...feature} />
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="landing-steps-title">
          <div className="landing-container">
            <h2 id="landing-steps-title">Jak to działa</h2>
            <ol className="landing-steps">
              {steps.map((step) => (
                <StepCard key={step.title} {...step} />
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-section landing-section--tinted" aria-labelledby="landing-trust-title">
          <div className="landing-container">
            <h2 id="landing-trust-title">Wiarygodność i zaufanie</h2>
            <div className="landing-grid landing-grid--stats">
              {stats.map((stat) => (
                <article key={stat.label} className="landing-stat" aria-label={stat.label}>
                  <p>{stat.value}</p>
                  <small>{stat.label}</small>
                </article>
              ))}
            </div>
            <div className="landing-grid landing-grid--testimonials">
              {testimonials.map((testimonial) => (
                <blockquote key={testimonial.author} className="landing-testimonial">
                  <p>{testimonial.quote}</p>
                  <footer>{testimonial.author}</footer>
                </blockquote>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-section--cta" aria-labelledby="landing-final-cta-title">
          <div className="landing-container">
            <h2 id="landing-final-cta-title">Uporządkuj finanse firmy i odzyskaj kontrolę nad fakturami</h2>
            <p className="landing-lead">Rozpocznij zespołowo w kilka minut i uporządkuj procesy finansowe w jednym panelu.</p>
            <div className="landing-hero__actions" role="group" aria-label="Finalne wezwanie do dzialania">
              <button type="button" className="landing-btn landing-btn--primary" onClick={() => onNavigateAuth('register')}>
                Załóż konto
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
            <a href="#">Polityka prywatnosci</a>
            <a href="#">Regulamin</a>
            <a href="#">Kontakt</a>
          </nav>
          <p className="landing-footer__note">
            Dane Twojej firmy są chronione zgodnie z dobrymi praktykami bezpieczeństwa i polityką ochrony danych.
          </p>
        </div>
      </footer>
    </div>
  )
}
