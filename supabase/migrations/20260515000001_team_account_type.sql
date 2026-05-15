-- Extend account_type to support 'team' accounts (internal team / freelancer onboarding).
-- The original constraint was added in 20260509000001_account_type.sql with only 'partnership' | 'project'.

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_account_type_check;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_account_type_check
  CHECK (account_type IN ('partnership', 'project', 'team'));

COMMENT ON COLUMN public.accounts.account_type IS
  'partnership = lane-based subscription client; project = per-quotation client; team = internal team / freelancer account';
