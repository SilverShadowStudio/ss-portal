alter table public.payslips add column if not exists back_pay numeric;
alter table public.payslips add column if not exists taxable_gross_pay numeric;
