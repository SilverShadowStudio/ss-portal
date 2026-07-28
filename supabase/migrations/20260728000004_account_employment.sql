alter table public.accounts add column if not exists employment_type text;        -- 'freelancer' | 'employee'
alter table public.accounts add column if not exists position text;               -- employee job title
alter table public.accounts add column if not exists gross_salary_annual numeric; -- employee gross annual salary
alter table public.accounts add column if not exists salary_start_date date;       -- employment / salary start
