export type SubscriptionRow = {
  id: string
  status: string
  provider: string
  planCode: string
  billingKind?: string | null
  currentPeriodEnd?: string | null
  trialEndsAt?: string | null
}

export type PrepaidInfo = {
  prepaidBilling: boolean
  prepaidEndsAt: string
  prepaidDaysRemaining: number
  prepaidRenewSoon: boolean
  prepaidExpired: boolean
}

export type WorkspaceUsage = {
  used: number
  limit: number | null
  planCode: string
  hasProEntitlement: boolean
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` }
}

export type BillingStripePublic = {
  mode: 'live' | 'test' | 'unset'
  /** true gdy sk_test — checkout PRO używa danych testowych Stripe */
  subscriptionCheckoutUsesTestData: boolean
}

export async function fetchBillingStripePublic(token: string): Promise<BillingStripePublic> {
  const res = await fetch('/api/v1/billing/stripe-public', { headers: authHeader(token) })
  const body = (await res.json()) as { data?: BillingStripePublic; error?: { message?: string } }
  if (!res.ok || !body.data) {
    throw new Error(body.error?.message ?? `Nie udało się pobrać trybu Stripe (${res.status})`)
  }
  return body.data
}

export async function fetchBillingSubscriptionState(token: string): Promise<{
  subscription: SubscriptionRow | null
  workspace: WorkspaceUsage
  prepaid: PrepaidInfo | null
}> {
  const res = await fetch('/api/v1/billing/subscription', { headers: authHeader(token) })
  const body = (await res.json()) as {
    data?: {
      subscription: SubscriptionRow | null
      workspace: WorkspaceUsage
      prepaid: PrepaidInfo | null
    }
    error?: { message?: string }
  }
  if (!res.ok || !body.data) {
    throw new Error(body.error?.message ?? `Nie udało się pobrać subskrypcji (${res.status})`)
  }
  return body.data
}

export async function createSubscriptionCheckout(
  token: string,
  input: {
    provider: 'STRIPE' | 'P24'
    planCode: 'free' | 'pro'
    successUrl: string
    cancelUrl: string
    paymentMethod?: 'CARD' | 'BLIK' | 'P24' | 'GOOGLE_PAY' | 'APPLE_PAY'
  },
): Promise<{ checkoutUrl: string }> {
  const res = await fetch('/api/v1/billing/subscription/checkout', {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = (await res.json()) as { checkoutUrl?: string; error?: { message?: string } }
  if (!res.ok || !body.checkoutUrl) throw new Error(body.error?.message ?? `Nie udało się utworzyć checkout (${res.status})`)
  return { checkoutUrl: body.checkoutUrl }
}

export async function switchSubscriptionPlan(token: string, planCode: 'free'): Promise<SubscriptionRow> {
  const res = await fetch('/api/v1/billing/subscription/switch-plan', {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ planCode }),
  })
  const body = (await res.json()) as { data?: SubscriptionRow; error?: { message?: string } }
  if (!res.ok || !body.data) throw new Error(body.error?.message ?? `Nie udało się zmienić planu (${res.status})`)
  return body.data
}

export async function createBillingPortalSession(token: string, returnUrl: string): Promise<{ portalUrl: string }> {
  const res = await fetch('/api/v1/billing/subscription/portal', {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnUrl }),
  })
  const body = (await res.json()) as { portalUrl?: string; error?: { message?: string } }
  if (!res.ok || !body.portalUrl) throw new Error(body.error?.message ?? `Nie udało się utworzyć portalu billing (${res.status})`)
  return { portalUrl: body.portalUrl }
}
