-- Billing model: Stripe recurring vs one-time BLIK prepaid (30-day access)
CREATE TYPE "SubscriptionBillingKind" AS ENUM ('STRIPE_RECURRING', 'STRIPE_PREPAID_BLIK');

ALTER TABLE "subscriptions" ADD COLUMN "billingKind" "SubscriptionBillingKind";
