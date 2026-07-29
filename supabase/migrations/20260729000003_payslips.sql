create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  period_label text,
  period_end date,
  gross numeric,
  income_tax numeric,
  employee_ni numeric,
  employee_pension numeric,
  net numeric,
  employer_ni numeric,
  employer_pension numeric,
  employer_cost numeric,                          -- gross + employer NI + employer pension
  document_path text,                             -- path in payslips bucket
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.payslips enable row level security;
drop policy if exists payslips_admin_all on public.payslips;
create policy payslips_admin_all on public.payslips for all using (public.is_admin()) with check (public.is_admin());
create index if not exists payslips_account_period_idx on public.payslips (account_id, period_end desc);

insert into storage.buckets (id, name, public) values ('payslips','payslips',false) on conflict (id) do nothing;
drop policy if exists payslips_admin_select on storage.objects;
drop policy if exists payslips_admin_insert on storage.objects;
drop policy if exists payslips_admin_update on storage.objects;
drop policy if exists payslips_admin_delete on storage.objects;
create policy payslips_admin_select on storage.objects for select using (bucket_id='payslips' and public.is_admin());
create policy payslips_admin_insert on storage.objects for insert with check (bucket_id='payslips' and public.is_admin());
create policy payslips_admin_update on storage.objects for update using (bucket_id='payslips' and public.is_admin()) with check (bucket_id='payslips' and public.is_admin());
create policy payslips_admin_delete on storage.objects for delete using (bucket_id='payslips' and public.is_admin());
