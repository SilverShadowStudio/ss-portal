-- Add account_type to distinguish partnership (lane subscription) clients
-- from project (per-quotation) clients. Defaults to 'partnership' so
-- existing accounts are unaffected.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'partnership'
  CHECK (account_type IN ('partnership', 'project'));

COMMENT ON COLUMN public.accounts.account_type IS
  'partnership = lane-based subscription client; project = per-quotation client';

-- Index for admin queries filtering by type
CREATE INDEX IF NOT EXISTS idx_accounts_type ON public.accounts(account_type);
