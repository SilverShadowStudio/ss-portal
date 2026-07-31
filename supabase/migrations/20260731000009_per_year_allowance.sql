-- Per-year paid-holiday allowance (it can change year to year). A row overrides
-- the account's default (accounts.annual_leave_allowance) for that year. Additive.
CREATE TABLE IF NOT EXISTS public.team_leave_allowances (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  year int NOT NULL,
  allowance numeric NOT NULL DEFAULT 20,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, year)
);
ALTER TABLE public.team_leave_allowances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_leave_allowances_admin ON public.team_leave_allowances;
CREATE POLICY team_leave_allowances_admin ON public.team_leave_allowances
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
