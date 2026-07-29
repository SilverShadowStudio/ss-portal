alter table public.accounts add column if not exists payroll_only boolean not null default false;
