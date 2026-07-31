-- Live Revolut cash position: a timestamped snapshot of pocket balances.
-- Additive only. Written by revolut-balances (on-demand + daily).
CREATE TABLE IF NOT EXISTS public.bank_balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at timestamptz NOT NULL DEFAULT now(),
  pockets jsonb NOT NULL,        -- [{ currency, balance, name }]
  total_gbp numeric NOT NULL
);
CREATE INDEX IF NOT EXISTS bank_balance_snapshots_time_idx ON public.bank_balance_snapshots (captured_at DESC);
ALTER TABLE public.bank_balance_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_balance_admin ON public.bank_balance_snapshots;
CREATE POLICY bank_balance_admin ON public.bank_balance_snapshots
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
