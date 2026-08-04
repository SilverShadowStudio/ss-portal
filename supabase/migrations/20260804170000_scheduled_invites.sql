-- Deferred team invitations. The account is created immediately (so the admin's
-- work is saved and can't be lost), but the invite email is held until send_at
-- and dispatched by cron. Mirrors pending_delivery_notifications.
create table if not exists public.scheduled_invites (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  email       text not null,
  send_at     timestamptz not null,
  sent_at     timestamptz,
  cancelled_at timestamptz,
  last_error  text,
  attempts    int not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
-- The dispatcher's query: due, not yet sent, not cancelled.
create index if not exists scheduled_invites_due_idx
  on public.scheduled_invites (send_at)
  where sent_at is null and cancelled_at is null;
create index if not exists scheduled_invites_account_idx on public.scheduled_invites (account_id);

alter table public.scheduled_invites enable row level security;
drop policy if exists scheduled_invites_admin_all on public.scheduled_invites;
create policy scheduled_invites_admin_all on public.scheduled_invites
  for all
  using      (exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'::app_role))
  with check (exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'::app_role));
