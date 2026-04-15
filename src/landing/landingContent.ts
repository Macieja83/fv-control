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
    description: 'Uruchom konto firmowe i skonfiguruj podstawowe dane organizacji.',
  },
  {
    title: 'Dodaj faktury i kontrahentów',
    description: 'Wprowadź dokumenty kosztowe i sprzedażowe oraz przypisz je do partnerów.',
  },
  {
    title: 'Monitoruj wyniki i terminy w jednym panelu',
    description: 'Na bieżąco kontroluj statusy płatności, saldo oraz kluczowe wskaźniki finansowe.',
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
