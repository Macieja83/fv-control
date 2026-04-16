export type LandingBenefit = {
  title: string
  description: string
}

export type LandingFeature = {
  icon: string
  title: string
  description: string
}

export type LandingStep = {
  title: string
  description: string
}

export type LandingStat = {
  label: string
  value: string
}

export type LandingTestimonial = {
  quote: string
  author: string
}

export const trustItems: string[] = ['Bezpieczne dane', 'Szybkie wdrożenie', 'Wsparcie dla MŚP']

export const benefits: LandingBenefit[] = [
  {
    title: 'Kontrola należności i zobowiązań',
    description: 'Widzisz pełny obraz płatności przychodzących i wychodzących w jednym miejscu.',
  },
  {
    title: 'Monitoring terminów płatności',
    description: 'System przypomina o zbliżających się terminach i pomaga unikać opóźnień.',
  },
  {
    title: 'Centralna baza faktur i kontrahentów',
    description: 'Dokumenty i dane partnerów są uporządkowane, łatwe do znalezienia i gotowe do analizy.',
  },
  {
    title: 'Raporty kosztów i przychodów',
    description: 'Szybko oceniasz rentowność i podejmujesz decyzje na podstawie aktualnych danych.',
  },
  {
    title: 'Mniej pracy ręcznej, mniej błędów',
    description: 'Automatyzujesz codzienne czynności, ograniczając pomyłki i czas obsługi faktur.',
  },
  {
    title: 'Lepsza płynność finansowa',
    description: 'Stałe monitorowanie salda i zaległości wspiera stabilny cash flow firmy.',
  },
]

export const features: LandingFeature[] = [
  {
    icon: 'FV',
    title: 'Rejestr faktur sprzedaży i kosztów',
    description: 'Każda faktura jest od razu widoczna w systemie, co przyspiesza kontrolę budżetu.',
  },
  {
    icon: 'PL',
    title: 'Statusy płatności i przypomnienia',
    description: 'Łatwo wychwytujesz opóźnienia i szybciej reagujesz na ryzyka finansowe.',
  },
  {
    icon: 'SZ',
    title: 'Filtry, wyszukiwanie, kategorie',
    description: 'Docierasz do potrzebnych danych w kilka sekund, nawet przy dużej liczbie dokumentów.',
  },
  {
    icon: 'KPI',
    title: 'Dashboard KPI',
    description: 'Monitorujesz przychód, koszty, saldo i zaległości bez przechodzenia między narzędziami.',
  },
  {
    icon: 'EXP',
    title: 'Eksport danych (placeholder)',
    description: 'Przygotowujesz dane do dalszych analiz i raportów dla księgowości lub zarządu.',
  },
]

export const steps: LandingStep[] = [
  {
    title: 'Załóż konto',
    description: 'E-mail i hasło lub Google. Uzupełnij NIP firmy w ustawieniach.',
  },
  {
    title: 'Połącz KSeF',
    description: 'W sekcji Płatności wklej token z portalu MF, PIN oraz opcjonalnie certyfikat — potem synchronizacja faktur.',
  },
  {
    title: 'Kontroluj dokumenty i subskrypcję',
    description: 'Plan Free: do 15 dokumentów (faktury + umowy). PRO: bez limitu — abonament w aplikacji (Stripe).',
  },
]

export type LandingPlanTier = {
  name: string
  priceLabel: string
  bullets: string[]
  highlighted?: boolean
}

export const planTiers: LandingPlanTier[] = [
  {
    name: 'Free',
    priceLabel: '0 zł',
    bullets: [
      'Do 15 dokumentów łącznie: faktury i umowy w jednym workspace',
      'Integracja KSeF po stronie klienta (własne poświadczenia MF)',
      'Logowanie e-mailem i hasłem lub przez Google',
    ],
  },
  {
    name: 'PRO',
    priceLabel: '99 zł / mies.',
    highlighted: true,
    bullets: [
      'Bez limitu dokumentów (faktury + umowy)',
      'Subskrypcja rozliczana w aplikacji (karta / Google Pay / Apple Pay przez Stripe)',
      'Customer Portal Stripe do zarządzania płatnością',
    ],
  },
]

export const stats: LandingStat[] = [
  { label: 'Firm korzysta z systemu', value: 'X+ firm' },
  { label: 'Faktur obsłużonych', value: 'Y+ faktur' },
  { label: 'Mniej opóźnionych płatności', value: 'Z%' },
]

export const testimonials: LandingTestimonial[] = [
  {
    quote: 'Placeholder: Dzięki Moje FV Control skróciliśmy czas obsługi faktur i mamy większą kontrolę nad terminami.',
    author: 'Imię Nazwisko, CFO (placeholder)',
  },
  {
    quote: 'Placeholder: Wszystkie dokumenty i statusy płatności są w jednym miejscu, co ułatwia pracę zespołu finansowego.',
    author: 'Imię Nazwisko, Właściciel firmy (placeholder)',
  },
  {
    quote: 'Placeholder: Dashboard KPI pozwala szybko ocenić kondycję finansową i reagować na opóźnienia.',
    author: 'Imię Nazwisko, Księgowość (placeholder)',
  },
]
