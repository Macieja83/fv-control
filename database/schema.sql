-- FV Resta / Invoice Inbox — PostgreSQL (propozycja)
-- Dostosuj tenant_id pod multi-restaurację w Resta.app.

CREATE TYPE invoice_source_type AS ENUM ('email', 'ksef', 'discord');
CREATE TYPE payment_status AS ENUM ('paid', 'unpaid');
CREATE TYPE document_scope AS ENUM ('business', 'private');
CREATE TYPE invoice_review_status AS ENUM ('cleared', 'needs_review');
CREATE TYPE duplicate_resolution AS ENUM ('none', 'confirmed', 'rejected');

CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  restaurant_id UUID REFERENCES restaurants (id),

  source_type invoice_source_type NOT NULL,
  source_account TEXT NOT NULL,

  supplier_name TEXT NOT NULL,
  supplier_nip VARCHAR(20) NOT NULL,
  invoice_number TEXT NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  gross_amount NUMERIC(14, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'PLN',

  category TEXT,
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  document_scope document_scope NOT NULL DEFAULT 'business',
  review_status invoice_review_status NOT NULL DEFAULT 'cleared',

  duplicate_score NUMERIC(4, 3) NOT NULL DEFAULT 0,
  duplicate_of_id UUID REFERENCES invoices (id) ON DELETE SET NULL,
  duplicate_reason TEXT,
  duplicate_resolution duplicate_resolution NOT NULL DEFAULT 'none',

  ksef_number TEXT,
  message_id TEXT,
  attachment_hash TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_tenant_issue ON invoices (tenant_id, issue_date DESC);
CREATE INDEX idx_invoices_supplier ON invoices (tenant_id, supplier_nip);
CREATE INDEX idx_invoices_ksef ON invoices (tenant_id, ksef_number) WHERE ksef_number IS NOT NULL;
CREATE INDEX idx_invoices_payment ON invoices (tenant_id, payment_status);
CREATE INDEX idx_invoices_review ON invoices (tenant_id, review_status);
CREATE INDEX idx_invoices_category_null ON invoices (tenant_id) WHERE category IS NULL;

CREATE TABLE invoice_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_invoice ON invoice_audit_log (invoice_id, created_at DESC);

COMMENT ON TABLE invoices IS 'Inbox faktur: e-mail, KSeF, Discord (kolejna faza).';
