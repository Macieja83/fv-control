import 'vanilla-cookieconsent/dist/cookieconsent.css'
import { run, showPreferences } from 'vanilla-cookieconsent'
import { syncPlausible } from './plausibleSync'
import './cookieconsent-overrides.css'

export function openCookieConsentPreferences(): void {
  showPreferences()
}

export async function initCookieConsent(): Promise<void> {
  await run({
    mode: 'opt-in',
    revision: 1,
    autoShow: true,
    disablePageInteraction: false,
    guiOptions: {
      consentModal: {
        layout: 'box inline',
        position: 'bottom right',
        equalWeightButtons: true,
      },
      preferencesModal: {
        layout: 'box',
        position: 'right',
      },
    },
    categories: {
      necessary: {
        readOnly: true,
      },
      analytics: {
        readOnly: false,
        services: {
          plausible: {
            label:
              'Plausible Analytics — zagregowane statystyki ruchu (bez profilowania reklamowego i bez udostępniania danych osobowych podmiotom trzecim w celach marketingowych).',
            onAccept: () => syncPlausible(),
            onReject: () => syncPlausible(),
          },
        },
      },
    },
    language: {
      default: 'pl',
      translations: {
        pl: {
          consentModal: {
            label: 'Zgoda na pliki cookie',
            title: 'Szanujemy Twoją prywatność',
            description:
              'Używamy niezbędnych plików cookie, aby strona działała (sesja, bezpieczeństwo). Opcjonalnie możesz włączyć anonimowe statystyki odwiedzin (Plausible), żeby ulepszać produkt. Szczegóły: <a href="/legal/polityka-prywatnosci" class="cc__link">polityka prywatności</a>.',
            acceptAllBtn: 'Akceptuję wszystkie',
            acceptNecessaryBtn: 'Tylko niezbędne',
            showPreferencesBtn: 'Ustawienia',
            footer: `<a href="/legal/polityka-prywatnosci">Pełna polityka prywatności</a>`,
          },
          preferencesModal: {
            title: 'Ustawienia prywatności',
            acceptAllBtn: 'Akceptuję wszystkie',
            acceptNecessaryBtn: 'Tylko niezbędne',
            savePreferencesBtn: 'Zapisz wybór',
            closeIconLabel: 'Zamknij',
            serviceCounterLabel: 'usługa|usługi',
            sections: [
              {
                title: 'Niezbędne',
                description:
                  'Te pliki cookie są wymagane do działania serwisu (np. utrzymanie sesji po zalogowaniu, ochrona przed nadużyciami). Nie można ich wyłączyć.',
                linkedCategory: 'necessary',
              },
              {
                title: 'Statystyka (opcjonalnie)',
                description:
                  'Pomaga nam zrozumieć, jak korzystasz ze strony, bez śledzenia cross-site i bez cookies reklamowych. Włączysz to tylko, jeśli wyrazisz zgodę.',
                linkedCategory: 'analytics',
              },
            ],
          },
        },
      },
    },
    onConsent: () => syncPlausible(),
    onChange: () => syncPlausible(),
  })

  syncPlausible()
}
