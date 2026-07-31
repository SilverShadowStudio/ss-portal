-- Employment start date for team members — the day they began at Silver Shadow.
-- Distinct from salary_start_date (payroll timing). Drives where each team
-- member's calendar begins. Additive.
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS work_start_date date;
COMMENT ON COLUMN public.accounts.work_start_date IS 'Day the team member started working at the studio; the calendar starts here.';
