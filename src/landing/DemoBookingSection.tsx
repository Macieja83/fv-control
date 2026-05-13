import './demo-booking.css'

function calendlyEmbedSrc(raw: string): string {
  if (raw.includes('embed_type=')) return raw
  return `${raw}${raw.includes('?') ? '&' : '?'}embed_type=Inline`
}

export function DemoBookingSection() {
  const raw =
    typeof import.meta.env.VITE_CALENDLY_EMBED_URL === 'string' ? import.meta.env.VITE_CALENDLY_EMBED_URL.trim() : ''
  if (!raw) return null

  return (
    <section className="demo-booking reveal" aria-labelledby="demo-booking-title">
      <div className="section-inner">
        <div className="section-label">Demo</div>
        <h2 id="demo-booking-title" className="section-h2">
          Umów krótką rozmowę
        </h2>
        <p className="section-lead">
          15–30 minut: przejdziemy przez KSeF, onboarding i dopasowanie do Twojej firmy.
        </p>
        <div className="demo-booking__frame-wrap">
          <iframe
            className="demo-booking__frame"
            title="Terminarz — umów demo"
            src={calendlyEmbedSrc(raw)}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
    </section>
  )
}
