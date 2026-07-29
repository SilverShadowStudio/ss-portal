create table if not exists public.recurring_overheads (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  category_code text,
  description text,
  currency text not null default 'GBP',
  net_amount numeric not null default 0,
  vat_amount numeric not null default 0,
  gross_amount numeric not null default 0,
  vat_treatment text,
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  start_date date not null,
  end_date date,                       -- null = open-ended
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.recurring_overheads enable row level security;
drop policy if exists recurring_overheads_admin_all on public.recurring_overheads;
create policy recurring_overheads_admin_all on public.recurring_overheads for all using (public.is_admin()) with check (public.is_admin());

-- Link generated overheads back to their template + period, for idempotency.
alter table public.overheads add column if not exists recurring_overhead_id uuid references public.recurring_overheads(id) on delete set null;
alter table public.overheads add column if not exists recurring_period text;  -- 'YYYY-MM'
create unique index if not exists overheads_recurring_unique on public.overheads (recurring_overhead_id, recurring_period) where recurring_overhead_id is not null;
