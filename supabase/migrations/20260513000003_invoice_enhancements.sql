-- Add quotation link, invoice type, and Stripe fields to invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS quotation_id UUID REFERENCES public.quotation_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'standalone',
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_checkout_url TEXT;

CREATE OR REPLACE FUNCTION public.validate_invoice_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.type NOT IN ('deposit', 'balance', 'standalone') THEN
    RAISE EXCEPTION 'Invalid invoice type: %', NEW.type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_invoice_type_trg ON public.invoices;
CREATE TRIGGER validate_invoice_type_trg
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.validate_invoice_type();

CREATE INDEX IF NOT EXISTS invoices_quotation_id_idx ON public.invoices(quotation_id);
