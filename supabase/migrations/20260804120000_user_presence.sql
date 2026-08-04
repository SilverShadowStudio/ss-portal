-- Live presence heartbeat. The client upserts last_seen_at every ~45s while the
-- portal tab is visible; admins read it to show a real-time "Active" badge.
create table if not exists public.user_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.user_presence enable row level security;

drop policy if exists user_presence_self on public.user_presence;
create policy user_presence_self on public.user_presence
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_presence_admin_read on public.user_presence;
create policy user_presence_admin_read on public.user_presence
  for select using (exists (
    select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'admin'
  ));
