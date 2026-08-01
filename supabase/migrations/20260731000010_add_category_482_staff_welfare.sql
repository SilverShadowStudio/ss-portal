-- Add expense category 482 · Staff Welfare (chart of accounts).
-- Sits between 481 Staff Training and 483 Medical Insurance (dropdown is ORDER BY code).
INSERT INTO public.expense_categories (code, name, default_vat_treatment, active)
VALUES ('482', 'Staff Welfare', 'standard', true)
ON CONFLICT (code) DO NOTHING;
