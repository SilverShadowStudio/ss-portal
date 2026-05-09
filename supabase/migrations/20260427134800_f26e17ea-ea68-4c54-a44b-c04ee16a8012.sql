-- Drop legacy status check constraint (statuses are validated by trigger validate_invoice_status)
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;

-- Default currency to GBP for new invoices
ALTER TABLE public.invoices ALTER COLUMN currency SET DEFAULT 'GBP';

-- Add VAT support
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS vat_rate numeric NOT NULL DEFAULT 20;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS subtotal numeric;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS vat_amount numeric;