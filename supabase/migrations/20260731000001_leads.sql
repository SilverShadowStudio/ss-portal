create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  contact_name text,
  email text,
  role text,
  sector text,
  website text,
  source text,
  status text not null default 'new',   -- new|contacted|replied|meeting|proposal|won|lost
  notes text,
  pitch_subject text,
  pitch_draft text,
  value_estimate numeric,
  last_contacted_at timestamptz,
  next_action_at date,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.leads enable row level security;
drop policy if exists leads_admin_all on public.leads;
create policy leads_admin_all on public.leads for all
  using (exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'::app_role))
  with check (exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'::app_role));
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_next_action_idx on public.leads (next_action_at);
