-- Add signing and deposit fields to quotation_documents
ALTER TABLE public.quotation_documents
  ADD COLUMN IF NOT EXISTS deposit_percentage NUMERIC NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS signed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS signed_by_position TEXT,
  ADD COLUMN IF NOT EXISTS net_total NUMERIC,
  ADD COLUMN IF NOT EXISTS gross_total NUMERIC,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC;
