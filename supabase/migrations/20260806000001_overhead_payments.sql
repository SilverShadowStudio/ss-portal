-- Overhead payments — supplier bank details + Revolut transfer tracking.
--
-- Additive only: new nullable columns on `overheads`, one new table. No
-- backfill, no altered or dropped objects.
--
-- Context: a dropped invoice is now filed and recorded UNPAID by the drop zone
-- (see src/lib/overheadRecord.ts). Paying it is a separate, deliberate action
-- on its Money Out row, executed by the `revolut-pay-overhead` edge function.
-- These columns are what that function reads and writes.

-- ── Bank details read off the invoice + the payment's own audit trail ───────
ALTER TABLE public.overheads
  ADD COLUMN IF NOT EXISTS supplier_iban           TEXT,
  ADD COLUMN IF NOT EXISTS supplier_account_number TEXT,
  ADD COLUMN IF NOT EXISTS supplier_sort_code      TEXT,
  ADD COLUMN IF NOT EXISTS supplier_bic            TEXT,
  ADD COLUMN IF NOT EXISTS paid_via                TEXT,
  ADD COLUMN IF NOT EXISTS revolut_transaction_id  TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference       TEXT,
  ADD COLUMN IF NOT EXISTS payment_error           TEXT,
  -- Claimed atomically before the transfer is submitted, so two clicks (or two
  -- tabs) can never put the same invoice through Revolut twice. Mirrors the
  -- dropbox_upload_in_progress lock already used for filing.
  ADD COLUMN IF NOT EXISTS payment_in_progress     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS payment_started_at      TIMESTAMPTZ;

COMMENT ON COLUMN public.overheads.paid_via IS
  'How the invoice was settled: revolut (transfer executed by the portal) or '
  'manual (Fred paid it elsewhere and marked it off).';
COMMENT ON COLUMN public.overheads.payment_in_progress IS
  'Transfer lock. Claimed by revolut-pay-overhead before submitting to Revolut '
  'and released on success or failure; a stale lock is recoverable after 5 min.';

-- One Revolut transaction settles exactly one overhead. A duplicate id here
-- means a double-submit slipped through every other guard, so make the
-- database itself refuse it.
CREATE UNIQUE INDEX IF NOT EXISTS overheads_revolut_transaction_id_key
  ON public.overheads (revolut_transaction_id)
  WHERE revolut_transaction_id IS NOT NULL;

-- ── Remembered supplier bank details + Revolut counterparty ────────────────
-- Keyed on the same normalized supplier name as supplier_category_map, so the
-- second invoice from a supplier needs no re-entry and no second counterparty.
CREATE TABLE IF NOT EXISTS public.supplier_bank_details (
  supplier_normalized     TEXT PRIMARY KEY,
  supplier_name           TEXT NOT NULL,
  iban                    TEXT,
  account_number          TEXT,
  sort_code               TEXT,
  bic                     TEXT,
  country                 TEXT,
  currency                TEXT NOT NULL DEFAULT 'GBP',
  revolut_counterparty_id TEXT,
  revolut_account_id      TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by              UUID,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.supplier_bank_details IS
  'Supplier payment details for the overhead Pay action, plus the Revolut '
  'counterparty id once created. Normalized supplier name is the key, matching '
  'supplier_category_map. Admin-only — never client-visible.';

ALTER TABLE public.supplier_bank_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_bank_details_admin_select ON public.supplier_bank_details;
DROP POLICY IF EXISTS supplier_bank_details_admin_insert ON public.supplier_bank_details;
DROP POLICY IF EXISTS supplier_bank_details_admin_update ON public.supplier_bank_details;
DROP POLICY IF EXISTS supplier_bank_details_admin_delete ON public.supplier_bank_details;

CREATE POLICY supplier_bank_details_admin_select ON public.supplier_bank_details
  FOR SELECT USING (public.is_admin());
CREATE POLICY supplier_bank_details_admin_insert ON public.supplier_bank_details
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY supplier_bank_details_admin_update ON public.supplier_bank_details
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY supplier_bank_details_admin_delete ON public.supplier_bank_details
  FOR DELETE USING (public.is_admin());
