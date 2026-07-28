create table if not exists public.taxes (
  id uuid primary key default gen_random_uuid(),
  tax_type text not null,                         -- 'vat' | 'corporation_tax' | 'paye_ni'
  period_label text,
  amount numeric not null default 0,
  currency text not null default 'GBP',
  due_date date,
  payment_status text not null default 'unpaid',  -- 'unpaid' | 'paid'
  payment_date date,
  document_path text,                             -- path in tax-documents bucket
  notes text,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.taxes enable row level security;
drop policy if exists taxes_admin_all on public.taxes;
create policy taxes_admin_all on public.taxes for all using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public) values ('tax-documents','tax-documents',false) on conflict (id) do nothing;
drop policy if exists tax_docs_admin_select on storage.objects;
drop policy if exists tax_docs_admin_insert on storage.objects;
drop policy if exists tax_docs_admin_update on storage.objects;
drop policy if exists tax_docs_admin_delete on storage.objects;
create policy tax_docs_admin_select on storage.objects for select using (bucket_id='tax-documents' and public.is_admin());
create policy tax_docs_admin_insert on storage.objects for insert with check (bucket_id='tax-documents' and public.is_admin());
create policy tax_docs_admin_update on storage.objects for update using (bucket_id='tax-documents' and public.is_admin()) with check (bucket_id='tax-documents' and public.is_admin());
create policy tax_docs_admin_delete on storage.objects for delete using (bucket_id='tax-documents' and public.is_admin());
