/** Cena PRO (PLN brutto, VAT 23%) — karta (subskrypcja Stripe) i jednorazowy BLIK/P24 (30 dni). */
export const PRO_PLAN_PRICE_PLN = 67;

/** PRO netto (brutto / 1.23, zaokrąglone do 0.01 PLN). 67 / 1.23 = 54.4715 → 54.47. */
export const PRO_PLAN_NET_PLN = 54.47;

/** PRO VAT (brutto - netto). 67.00 - 54.47 = 12.53. */
export const PRO_PLAN_VAT_PLN = 12.53;

/** Stawka VAT dla subskrypcji SaaS — 23% standard PL. */
export const PRO_PLAN_VAT_RATE = 23;

/** Dostęp PRO po jednorazowej płatności BLIK/P24 (dni). */
export const PRO_PREPAID_PERIOD_DAYS = 30;
