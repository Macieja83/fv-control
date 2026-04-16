export const COST_CATEGORIES = [
  'Żywność i napoje',
  'Chemia i środki czystości',
  'Energia i media',
  'Usługi gastronomiczne / outsourcing',
  'Sprzęt i wyposażenie',
  'Marketing i reklama',
  'IT i oprogramowanie',
  'Transport i logistyka',
  'Czynsz i najem',
  'Personel / BHP',
  'Inne',
] as const

/** Kategorie raportowe dla faktur sprzedaży (przychody). */
export const REVENUE_CATEGORIES = [
  'Sprzedaż towarów',
  'Sprzedaż usług',
  'Eksport / WDT',
  'Odsetki i dyskonta',
  'Pozostałe przychody',
  'Inne',
] as const

/** Unia list (filtry, szybkie wybory); „Inne” występuje raz. */
export const ALL_REPORT_CATEGORIES = Array.from(new Set([...COST_CATEGORIES, ...REVENUE_CATEGORIES]))
