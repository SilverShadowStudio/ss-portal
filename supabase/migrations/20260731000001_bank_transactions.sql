-- 20260731000001_bank_transactions.sql
--
-- ADDITIVE. Foundation of the bank-reconciliation subsystem: a mirror of the
-- Revolut Business account feed. Every cash movement lands here (from CSV now,
-- the Revolut read API later), deduped on Revolut's own transaction id, then
-- classified and matched to the portal's accounting records.
--
-- The bank is cash TRUTH; the portal keeps the accounting layer (VAT, category,
-- documents). Reconciliation matches the two. Non-trading movements (internal
-- FX, pocket transfers, directors-loan financing) are classified out so they
-- never touch the P&L.

CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id                TEXT PRIMARY KEY,            -- Revolut transaction ID (dedup key)
  date_started      DATE,
  date_completed    DATE,
  type              TEXT,                         -- TRANSFER / CARD_PAYMENT / TOPUP / FEE / EXCHANGE / REFUND
  state             TEXT,
  description       TEXT,
  reference         TEXT,
  counterparty      TEXT,                         -- sender (income) or beneficiary/description (expense)
  orig_currency     TEXT,
  orig_amount       NUMERIC,
  amount            NUMERIC NOT NULL,             -- GBP, signed: +in / -out
  fee               NUMERIC DEFAULT 0,
  balance           NUMERIC,                      -- running account balance after this txn
  account           TEXT,                         -- e.g. "GBP Revenue"
  mcc               TEXT,                         -- merchant category code (card spend)

  -- Reconciliation state
  classification    TEXT NOT NULL DEFAULT 'uncategorized',
                    -- client_income | expense | internal_fx | pocket_move |
                    -- directors_loan | bank_fee | refund | ebay_resale | uncategorized
  category_code     TEXT,                         -- expense_categories.code, once categorised
  matched_type      TEXT,                         -- income_invoice | overhead | payslip | payable
  matched_id        UUID,
  match_confidence  TEXT,                         -- reference | counterparty_amount | manual
  status            TEXT NOT NULL DEFAULT 'unreconciled',
                    -- unreconciled | matched | confirmed | excluded
  reviewed          BOOLEAN NOT NULL DEFAULT FALSE,
  notes             TEXT,
  raw               JSONB,                        -- the full source row, for audit
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_txns_completed_idx ON public.bank_transactions (date_completed DESC);
CREATE INDEX IF NOT EXISTS bank_txns_status_idx    ON public.bank_transactions (status);
CREATE INDEX IF NOT EXISTS bank_txns_class_idx     ON public.bank_transactions (classification);
CREATE INDEX IF NOT EXISTS bank_txns_ref_idx       ON public.bank_transactions (reference);

-- Admin-only, mirroring every other finance table.
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_txns_admin_all ON public.bank_transactions;
CREATE POLICY bank_txns_admin_all ON public.bank_transactions
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
