-- Receipt reconciliation: catalog of the files under Dropbox
-- /03_Portal_Admin_Docs/03_Invoices, matched against bank_transactions.
-- Additive only (new column + new table).

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS receipt_dropbox_path text;
COMMENT ON COLUMN public.bank_transactions.receipt_dropbox_path IS 'Path of the matched receipt/invoice file in Dropbox 03_Invoices (null = missing receipt).';

CREATE TABLE IF NOT EXISTS public.dropbox_invoice_files (
  id text PRIMARY KEY,                 -- Dropbox file id (stable across rename)
  path text NOT NULL,                  -- current path_display
  name text NOT NULL,
  size bigint,
  content_hash text,
  side text,                           -- receivable | payable_overhead | payable_freelancer | other
  parsed_invoice_no text,
  parsed_amount numeric,
  parsed_date date,
  parsed_vendor text,
  parse_source text,                   -- filename | ai
  matched_txn_id text REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  match_confidence text,               -- invoice_no | amount_date | manual
  status text NOT NULL DEFAULT 'unmatched',  -- matched | unmatched | ignored
  renamed_from text,
  renamed_to text,
  renamed_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dropbox_invoice_files_txn_idx ON public.dropbox_invoice_files (matched_txn_id);
CREATE INDEX IF NOT EXISTS dropbox_invoice_files_status_idx ON public.dropbox_invoice_files (status);

ALTER TABLE public.dropbox_invoice_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dropbox_invoice_files_admin ON public.dropbox_invoice_files;
CREATE POLICY dropbox_invoice_files_admin ON public.dropbox_invoice_files
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
