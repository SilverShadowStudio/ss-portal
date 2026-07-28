create table if not exists public.self_bill_invoices (
  id uuid primary key default gen_random_uuid(),
  source_table text not null,
  airtable_record_id text,
  payee_email text,
  payee_name text,
  freelancer_user_id uuid,
  period_year int not null,
  period_month int not null,
  invoice_number text not null,
  role_label text,
  net numeric not null default 0,
  vat_amount numeric not null default 0,
  gross numeric not null default 0,
  currency text not null default 'GBP',
  line_count int not null default 0,
  dropbox_path text,
  emailed_at timestamptz,
  created_at timestamptz default now(),
  unique (source_table, payee_email, period_year, period_month)
);
alter table public.self_bill_invoices enable row level security;
drop policy if exists self_bill_admin_all on public.self_bill_invoices;
create policy self_bill_admin_all on public.self_bill_invoices
  for all using (public.is_admin()) with check (public.is_admin());
