-- Extend invoices table for the new Finance module
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS account_id uuid,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill invoice_number from existing reference_number when missing
UPDATE public.invoices SET invoice_number = reference_number WHERE invoice_number IS NULL;

-- Make invoice_number unique (nullable allowed for legacy rows already filled above)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'invoices_invoice_number_unique_idx'
  ) THEN
    CREATE UNIQUE INDEX invoices_invoice_number_unique_idx
      ON public.invoices(invoice_number)
      WHERE invoice_number IS NOT NULL;
  END IF;
END$$;

-- Status validation trigger (Draft / Sent / Paid / Overdue / pending kept for legacy)
CREATE OR REPLACE FUNCTION public.validate_invoice_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('draft','sent','paid','overdue','pending','cancelled') THEN
    RAISE EXCEPTION 'Invalid invoice status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_invoice_status_trg ON public.invoices;
CREATE TRIGGER validate_invoice_status_trg
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.validate_invoice_status();

-- updated_at trigger
DROP TRIGGER IF EXISTS update_invoices_updated_at ON public.invoices;
CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helpful indexes
CREATE INDEX IF NOT EXISTS invoices_account_id_idx ON public.invoices(account_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON public.invoices(status);
CREATE INDEX IF NOT EXISTS invoices_due_date_idx ON public.invoices(due_date);

-- Update RLS so account members can view invoices linked to their account_id
DROP POLICY IF EXISTS "Members can view account invoices" ON public.invoices;
CREATE POLICY "Members can view account invoices"
ON public.invoices
FOR SELECT
TO authenticated
USING (
  (account_id IS NOT NULL AND is_account_member(account_id))
  OR (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = invoices.project_id AND is_account_member(p.account_id)
  ))
  OR (EXISTS (
    SELECT 1 FROM account_members am
    WHERE am.user_id = invoices.user_id AND is_account_member(am.account_id)
  ))
);
