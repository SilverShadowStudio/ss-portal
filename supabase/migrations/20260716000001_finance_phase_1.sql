-- =====================================================================
-- Phase 1 Finance Module — expense_categories + overheads
--
-- Delivered as a migration FILE per hard rule. Do NOT run `supabase db push`.
-- Apply via Supabase Dashboard → SQL editor. Idempotent (safe to re-run).
--
-- Order matters: the category seed runs BEFORE RLS is enabled on
-- expense_categories, so it is never gated by the admin-only INSERT policy
-- (which would depend on the applying role passing public.is_admin()).
--
-- Notes on reverse-charge handling (see reverse_charge_vat column):
--   When is_reverse_charge = true, vat_amount stays 0 and the row is
--   EXCLUDED from the cash-basis input-VAT sum. The notional self-accounted
--   VAT (net × 20% unless the document states otherwise) is stored in
--   reverse_charge_vat so Lindsay can read the figure straight off the
--   portal without recomputing it.
-- =====================================================================

-- 1. expense_categories ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expense_categories (
  code                   text     PRIMARY KEY,
  name                   text     NOT NULL,
  default_vat_treatment  text     NOT NULL
    CHECK (default_vat_treatment IN
      ('standard','reduced','zero','exempt','none','reverse_charge')),
  active                 boolean  NOT NULL DEFAULT true
);

COMMENT ON TABLE public.expense_categories IS
  'Xero-aligned overhead categories (400-series). Seed data; soft-hide via active=false.';

-- 2. overheads ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.overheads (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by          uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  supplier_name       text          NOT NULL,
  category_code       text          REFERENCES public.expense_categories(code)
                                    ON DELETE RESTRICT,
  description         text,
  currency            text          NOT NULL DEFAULT 'GBP',
  net_amount          numeric(12,2) NOT NULL,
  vat_amount          numeric(12,2) NOT NULL DEFAULT 0,
  gross_amount        numeric(12,2) NOT NULL,
  vat_treatment       text          NOT NULL
    CHECK (vat_treatment IN
      ('standard','reduced','zero','exempt','none','reverse_charge')),
  invoice_number      text,
  invoice_date        date          NOT NULL,
  due_date            date,
  payment_date        date,
  payment_status      text          NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','paid')),
  is_reverse_charge   boolean       NOT NULL DEFAULT false,
  reverse_charge_vat  numeric(12,2) NOT NULL DEFAULT 0,
  source              text          NOT NULL DEFAULT 'manual',
  dropbox_path        text,
  notes               text
);

COMMENT ON TABLE public.overheads IS
  'Cash-basis overhead ledger. payment_date drives VAT quarter inclusion.';
COMMENT ON COLUMN public.overheads.reverse_charge_vat IS
  'Notional self-accounted VAT for reverse-charge rows (net × 20% unless the document states otherwise). Zero on non-reverse-charge rows. NOT part of the cash-basis input-VAT sum; surfaced separately on the finance dashboard.';

-- 3. Seed expense_categories -------------------------------------------
-- Runs BEFORE RLS is enabled below, so it is never gated by the admin-only
-- INSERT policy. Idempotent via ON CONFLICT DO NOTHING so re-runs are safe.
-- Excluded (journal/payroll/production, not drop-an-invoice items):
--   depreciation, amortisation, salaries, directors' remuneration, NI,
--   pensions, interest paid, HP interest, bad debt, and DirectCosts
--   310/320/325 which are Kieran's Airtable domain.
INSERT INTO public.expense_categories (code, name, default_vat_treatment) VALUES
  ('400', 'Advertising & Marketing',              'standard'),
  ('401', 'Audit & Accountancy Fees',             'standard'),
  ('404', 'Bank Fees',                            'none'),
  ('408', 'Cleaning',                             'standard'),
  ('412', 'Consulting',                           'standard'),
  ('418', 'Charitable & Political Donations',     'zero'),
  ('420', 'Entertainment - 100% Business',        'standard'),
  ('424', 'Entertainment - 0%',                   'none'),
  ('425', 'Postage, Freight & Courier',           'exempt'),
  ('429', 'General Expenses',                     'standard'),
  ('433', 'Insurance',                            'exempt'),
  ('441', 'Legal Expenses',                       'standard'),
  ('445', 'Light, Power, Heating',                'reduced'),
  ('449', 'Motor Vehicle Expenses',               'standard'),
  ('457', 'Operating Lease Payments',             'standard'),
  ('461', 'Printing & Stationery',                'standard'),
  ('462', 'Computer Hardware',                    'standard'),
  ('463', 'Computer Software',                    'standard'),
  ('464', 'Other Computer Costs',                 'standard'),
  ('465', 'Rates',                                'exempt'),
  ('466', 'Use of Home',                          'standard'),
  ('469', 'Rent',                                 'exempt'),
  ('470', 'Office Costs',                         'standard'),
  ('471', 'Office Parking',                       'standard'),
  ('473', 'Repairs & Maintenance',                'standard'),
  ('481', 'Staff Training',                       'standard'),
  ('483', 'Medical Insurance',                    'exempt'),
  ('485', 'Subscriptions',                        'standard'),
  ('489', 'Telephone & Internet',                 'standard'),
  ('491', 'Travel - International',               'none'),
  ('492', 'Accommodation and Meals',              'standard'),
  ('493', 'Travel - National',                    'standard')
ON CONFLICT (code) DO NOTHING;

-- 4. Dedup guard --------------------------------------------------------
-- Prevents accidental re-entry of the same supplier invoice.
-- Partial: only enforced when invoice_number is present, so ad-hoc rows
-- without an invoice number (e.g. bank fees) can repeat freely.
CREATE UNIQUE INDEX IF NOT EXISTS overheads_supplier_invoice_unique_idx
  ON public.overheads (supplier_name, invoice_number)
  WHERE invoice_number IS NOT NULL;

-- 5. updated_at trigger -------------------------------------------------
DROP TRIGGER IF EXISTS overheads_set_updated_at ON public.overheads;
CREATE TRIGGER overheads_set_updated_at
  BEFORE UPDATE ON public.overheads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. RLS (last, so nothing above is gated by is_admin()) ---------------
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overheads          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_categories_admin_select ON public.expense_categories;
DROP POLICY IF EXISTS expense_categories_admin_insert ON public.expense_categories;
DROP POLICY IF EXISTS expense_categories_admin_update ON public.expense_categories;
DROP POLICY IF EXISTS expense_categories_admin_delete ON public.expense_categories;

CREATE POLICY expense_categories_admin_select ON public.expense_categories
  FOR SELECT USING (public.is_admin());
CREATE POLICY expense_categories_admin_insert ON public.expense_categories
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY expense_categories_admin_update ON public.expense_categories
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY expense_categories_admin_delete ON public.expense_categories
  FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS overheads_admin_select ON public.overheads;
DROP POLICY IF EXISTS overheads_admin_insert ON public.overheads;
DROP POLICY IF EXISTS overheads_admin_update ON public.overheads;
DROP POLICY IF EXISTS overheads_admin_delete ON public.overheads;

CREATE POLICY overheads_admin_select ON public.overheads
  FOR SELECT USING (public.is_admin());
CREATE POLICY overheads_admin_insert ON public.overheads
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY overheads_admin_update ON public.overheads
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY overheads_admin_delete ON public.overheads
  FOR DELETE USING (public.is_admin());
