-- Hourly work — team members paid by the hour log their hours in the portal.
--
-- Fred, 11 Nov 2026, for Isabella Goldsmith (freelance business development,
-- £18/h): she logs her hours; up to her weekly hours they go straight through,
-- anything above waits for Fred's approval like a holiday request. Approved
-- hours are written to Airtable (Business Development Timesheet) and invoiced
-- with everyone else's on the 1st.
--
-- team_hours_settings — per member, set by an admin only. A member may READ
--   her own row (she sees "of 8 h"), never change it. A member with no row
--   doesn't log hours and has no Hours page.
-- team_hours — one row per logged entry. Writes go through the team-calendar
--   function (service role), which does the weekly split and the Airtable
--   write; members may read their own entries, admins everything.
--
-- ADDITIVE: two new tables with their own policies. Nothing existing touched.

create table if not exists public.team_hours_settings (
  account_id   uuid primary key references public.accounts(id) on delete cascade,
  weekly_hours numeric(5,2) not null default 8 check (weekly_hours >= 0 and weekly_hours <= 80),
  hourly_rate  numeric(8,2) check (hourly_rate is null or hourly_rate >= 0),
  updated_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now()
);
alter table public.team_hours_settings enable row level security;
drop policy if exists team_hours_settings_admin on public.team_hours_settings;
create policy team_hours_settings_admin on public.team_hours_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists team_hours_settings_member_read on public.team_hours_settings;
create policy team_hours_settings_member_read on public.team_hours_settings
  for select to authenticated using (public.is_account_member(account_id));
grant select, insert, update, delete on public.team_hours_settings to authenticated;

create table if not exists public.team_hours (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  user_id            uuid not null references auth.users(id),
  work_date          date not null,
  hours              numeric(5,2) not null check (hours > 0 and hours <= 24),
  note               text,
  status             text not null default 'approved' check (status in ('approved', 'pending', 'declined')),
  airtable_record_id text,
  airtable_error     text,
  reviewed_by        uuid references auth.users(id),
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists team_hours_account_date_idx on public.team_hours (account_id, work_date);
create index if not exists team_hours_pending_idx on public.team_hours (status) where status = 'pending';
alter table public.team_hours enable row level security;
drop policy if exists team_hours_admin_all on public.team_hours;
create policy team_hours_admin_all on public.team_hours
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists team_hours_member_read on public.team_hours;
create policy team_hours_member_read on public.team_hours
  for select to authenticated using (public.is_account_member(account_id));
grant select, insert, update, delete on public.team_hours to authenticated;
