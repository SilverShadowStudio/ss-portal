alter table public.payslips add column if not exists student_loan numeric;
alter table public.payslips add column if not exists salary_paid_at timestamptz;  -- net paid to employee
alter table public.payslips add column if not exists tax_paid_at timestamptz;      -- PAYE/NI paid to HMRC
