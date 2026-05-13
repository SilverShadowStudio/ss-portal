-- Add client_code to accounts for quotation number generation
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS client_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_client_code_unique_idx
  ON public.accounts(client_code)
  WHERE client_code IS NOT NULL;
