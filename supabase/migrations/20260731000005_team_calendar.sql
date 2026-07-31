-- Team availability calendar: bank holidays, per-employee leave allowance, and
-- day-level leave / unavailability requests with an admin approval workflow.
-- Additive only (new tables + one new column). Worked days are NOT stored here —
-- they're pulled live from Airtable (freelancers) or derived from the working
-- week (salaried employees) by the team-calendar edge function.

-- 1. UK bank holidays (loaded from gov.uk bank-holidays.json). Read by any
--    authenticated user (shown on every team member's calendar); admin-managed.
CREATE TABLE IF NOT EXISTS public.bank_holidays (
  holiday_date date NOT NULL,
  division text NOT NULL DEFAULT 'england-and-wales',
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (division, holiday_date)
);
ALTER TABLE public.bank_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_holidays_read ON public.bank_holidays;
CREATE POLICY bank_holidays_read ON public.bank_holidays
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS bank_holidays_admin_write ON public.bank_holidays;
CREATE POLICY bank_holidays_admin_write ON public.bank_holidays
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 2. Per-employee annual leave allowance (days/year). Default 20; admin can
--    raise it per person (negotiated extra days). Bank holidays are separate and
--    do not consume this.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS annual_leave_allowance numeric NOT NULL DEFAULT 20;

COMMENT ON COLUMN public.accounts.annual_leave_allowance IS 'Paid annual leave days per calendar year for a team account (default 20, admin-adjustable). Bank holidays are on top and not counted here.';

-- 3. Day-level leave / unavailability requests. One row per requested day.
--    kind: holiday (paid annual leave, counts against allowance when approved)
--          unavailable (a day the person does not want to work; not paid leave).
--    fraction: 1 = full day, 0.5 = half day.
CREATE TABLE IF NOT EXISTS public.team_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  leave_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('holiday', 'unavailable')),
  fraction numeric NOT NULL DEFAULT 1 CHECK (fraction > 0 AND fraction <= 1),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  note text,
  requested_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, leave_date, kind)
);
CREATE INDEX IF NOT EXISTS team_leave_requests_account_date_idx
  ON public.team_leave_requests (account_id, leave_date);

ALTER TABLE public.team_leave_requests ENABLE ROW LEVEL SECURITY;

-- Admin-only at the table level. Team members read/write their own days through
-- the team-calendar edge function (service role + in-handler caller check), the
-- same pattern as freelancer-earnings — so no cross-account leakage via RLS.
DROP POLICY IF EXISTS team_leave_admin_all ON public.team_leave_requests;
CREATE POLICY team_leave_admin_all ON public.team_leave_requests
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
