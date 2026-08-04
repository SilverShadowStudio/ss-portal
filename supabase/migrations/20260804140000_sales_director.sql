-- Sales Director schema. Reps are NOT admins. Visibility via can_see_all_sales()
-- (admin | sales_manager); a 'sales' rep sees only their own owned pipeline.
-- is_admin() is intentionally NOT defined or referenced here.
-- The two new app_role values are added in 20260804139000_app_role_add_sales.sql,
-- which commits first (ALTER TYPE ADD VALUE can't be used in the tx that adds it).

create or replace function public.can_see_all_sales()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role::text in ('admin','sales_manager')
  );
$$;

-- ── 1. pipeline_stages (seeded). Readable by any sales-capable role. ──────────
create table if not exists public.pipeline_stages (
  key text primary key,
  label text not null,
  sort_order int not null,
  probability numeric not null,
  is_terminal boolean not null default false,
  is_active boolean not null default true
);
insert into public.pipeline_stages (key, label, sort_order, probability, is_terminal) values
  ('new','New',10,0.05,false),
  ('contacted','Contacted',20,0.10,false),
  ('engaged','Engaged',30,0.20,false),
  ('qualified','Qualified',40,0.35,false),
  ('proposal','Proposal',50,0.50,false),
  ('negotiation','Negotiation',60,0.70,false),
  ('won','Won',70,1.00,true),
  ('lost','Lost',80,0.00,true),
  ('dead','Dead',90,0.00,true)
on conflict (key) do nothing;

alter table public.pipeline_stages enable row level security;
drop policy if exists pipeline_stages_read on public.pipeline_stages;
create policy pipeline_stages_read on public.pipeline_stages
  for select using (
    exists (select 1 from public.user_roles
      where user_id = auth.uid() and role::text in ('admin','sales_manager','sales')));

-- ── 2. leads — extend. Margin left NULL (no invented default); actual_margin_pct
--       is a column only for now (3 invoices vs cost-only payables ≠ a real number). ──
alter table public.leads
  add column if not exists stage                text references public.pipeline_stages(key),
  add column if not exists outcome              text,
  add column if not exists loss_reason          text,
  add column if not exists loss_reason_category text,
  add column if not exists closed_at            timestamptz,
  add column if not exists expected_margin_pct  numeric,   -- NULL until asked at qualification
  add column if not exists actual_margin_pct    numeric,   -- column only; computation deferred
  add column if not exists margin_source        text,      -- seam: 'manual'|'airtable'|'computed'
  add column if not exists owner_id             uuid references auth.users(id),
  add column if not exists converted_account_id uuid references public.accounts(id),
  add column if not exists stalled_at           timestamptz,
  add column if not exists import_source        text,
  add column if not exists import_row_hash      text;

update public.leads set stage = 'won', outcome = 'won' where status = 'won' and stage is null;
update public.leads set stage = 'new' where stage is null;
alter table public.leads alter column stage set default 'new';
alter table public.leads alter column stage set not null;

-- Deterministic owner backfill: assert exactly one admin, use that UUID
-- (405f1a0b-9aef-4570-9444-795572cbb818 today). No bare limit 1.
do $$
declare admin_count int; admin_uid uuid;
begin
  select count(*) into admin_count from public.user_roles where role = 'admin'::app_role;
  if admin_count <> 1 then
    raise exception 'sales_director: expected exactly one admin, found %', admin_count;
  end if;
  select user_id into admin_uid from public.user_roles where role = 'admin'::app_role;
  update public.leads set owner_id = admin_uid where owner_id is null;
end $$;
alter table public.leads alter column owner_id set not null;

create unique index if not exists leads_import_row_hash_uq on public.leads (import_row_hash) where import_row_hash is not null;
create index if not exists leads_stage_idx       on public.leads (stage);
create index if not exists leads_owner_idx       on public.leads (owner_id);
create index if not exists leads_next_action_idx on public.leads (next_action_at);
create index if not exists leads_stalled_idx     on public.leads (stalled_at);

-- Replace the old admin-only leads policy with the sales visibility model.
drop policy if exists leads_admin_all on public.leads;
drop policy if exists leads_sales_visibility on public.leads;
create policy leads_sales_visibility on public.leads
  for all
  using      (public.can_see_all_sales() or owner_id = auth.uid())
  with check (public.can_see_all_sales() or owner_id = auth.uid());

-- ── 3. contacts — scoped to the owner of the parent lead. ─────────────────────
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  name text, title text, email text, phone text, linkedin text,
  role_type text,      -- 'champion'|'blocker'|'economic_buyer'|'gatekeeper'|'unknown'
  is_primary boolean default false,
  created_at timestamptz default now()
);
create index if not exists contacts_lead_idx on public.contacts (lead_id);

alter table public.contacts enable row level security;
drop policy if exists contacts_sales_visibility on public.contacts;
create policy contacts_sales_visibility on public.contacts
  for all
  using      (public.can_see_all_sales() or exists (
                select 1 from public.leads l where l.id = contacts.lead_id and l.owner_id = auth.uid()))
  with check (public.can_see_all_sales() or exists (
                select 1 from public.leads l where l.id = contacts.lead_id and l.owner_id = auth.uid()));

-- ── 4. lead_events (append-only) + trigger. Synthetic 'created' rows inserted
--       AFTER the trigger exists so backfilled leads have non-empty timelines. ──
create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_type text not null,   -- 'created'|'stage_change'|'outcome_set'|'owner_change'|'value_change'
  from_value text,
  to_value   text,
  actor_id   uuid,
  source     text not null default 'ui',   -- 'ui'|'coach'|'import'|'system'|'migration'
  created_at timestamptz not null default now()
);
create index if not exists lead_events_lead_idx on public.lead_events (lead_id, created_at);

create or replace function public.tg_lead_events()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.lead_events (lead_id, event_type, to_value, actor_id, source)
      values (new.id, 'created', new.stage, auth.uid(), 'system');
  elsif (tg_op = 'UPDATE') then
    if new.stage is distinct from old.stage then
      insert into public.lead_events (lead_id, event_type, from_value, to_value, actor_id, source)
        values (new.id, 'stage_change', old.stage, new.stage, auth.uid(), 'ui');
    end if;
    if new.outcome is distinct from old.outcome then
      insert into public.lead_events (lead_id, event_type, from_value, to_value, actor_id, source)
        values (new.id, 'outcome_set', old.outcome, new.outcome, auth.uid(), 'ui');
    end if;
    if new.owner_id is distinct from old.owner_id then
      insert into public.lead_events (lead_id, event_type, from_value, to_value, actor_id, source)
        values (new.id, 'owner_change', old.owner_id::text, new.owner_id::text, auth.uid(), 'ui');
    end if;
    if new.value_estimate is distinct from old.value_estimate then
      insert into public.lead_events (lead_id, event_type, from_value, to_value, actor_id, source)
        values (new.id, 'value_change', old.value_estimate::text, new.value_estimate::text, auth.uid(), 'ui');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_lead_events on public.leads;
create trigger trg_lead_events after insert or update on public.leads
  for each row execute function public.tg_lead_events();

insert into public.lead_events (lead_id, event_type, to_value, source, created_at)
  select id, 'created', stage, 'migration', coalesce(created_at, now()) from public.leads;

alter table public.lead_events enable row level security;
drop policy if exists lead_events_sales_read on public.lead_events;
create policy lead_events_sales_read on public.lead_events
  for select using (public.can_see_all_sales() or exists (
    select 1 from public.leads l where l.id = lead_events.lead_id and l.owner_id = auth.uid()));
drop policy if exists lead_events_sales_insert on public.lead_events;
create policy lead_events_sales_insert on public.lead_events
  for insert with check (public.can_see_all_sales() or exists (
    select 1 from public.leads l where l.id = lead_events.lead_id and l.owner_id = auth.uid()));
-- No update/delete policy → append-only audit (a SELECT policy takes only USING,
-- an INSERT policy only WITH CHECK; every for-all policy below carries both).

-- ── 5. interactions + last_contacted_at / un-stall trigger. ───────────────────
create table if not exists public.interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  type       text not null,   -- 'call'|'email'|'meeting'|'linkedin'|'whatsapp'|'other'
  direction  text,            -- 'outbound'|'inbound'
  outcome    text,            -- 'no_answer'|'left_message'|'spoke'|'meeting_booked'|'pushed'|'objection'|'dead'|'other'
  summary    text,            -- LLM-normalised
  raw_debrief text,           -- exactly what the rep typed. NEVER discard.
  objection  text,
  occurred_at timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists interactions_lead_idx    on public.interactions (lead_id, occurred_at);
create index if not exists interactions_contact_idx on public.interactions (contact_id);

create or replace function public.tg_interaction_touch()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.leads
    set last_contacted_at = greatest(coalesce(last_contacted_at, new.occurred_at), new.occurred_at),
        stalled_at = null
    where id = new.lead_id;
  return new;
end $$;

drop trigger if exists trg_interaction_touch on public.interactions;
create trigger trg_interaction_touch after insert on public.interactions
  for each row execute function public.tg_interaction_touch();

alter table public.interactions enable row level security;
drop policy if exists interactions_sales_visibility on public.interactions;
create policy interactions_sales_visibility on public.interactions
  for all
  using      (public.can_see_all_sales() or exists (
                select 1 from public.leads l where l.id = interactions.lead_id and l.owner_id = auth.uid()))
  with check (public.can_see_all_sales() or exists (
                select 1 from public.leads l where l.id = interactions.lead_id and l.owner_id = auth.uid()));

-- ── 6. commitments — owner-scoped. ───────────────────────────────────────────
create table if not exists public.commitments (
  id uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.leads(id) on delete cascade,
  interaction_id uuid references public.interactions(id) on delete set null,
  party          text not null,   -- 'us'|'them'
  description    text not null,
  due_date       date not null,
  status         text not null default 'open',  -- 'open'|'kept'|'missed'|'cancelled'
  owner_id       uuid not null references auth.users(id),
  slip_count     int not null default 0,
  original_due_date date,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists commitments_lead_idx  on public.commitments (lead_id);
create index if not exists commitments_owner_idx on public.commitments (owner_id, status, due_date);

alter table public.commitments enable row level security;
drop policy if exists commitments_owner_all on public.commitments;
create policy commitments_owner_all on public.commitments
  for all
  using      (owner_id = auth.uid() or public.can_see_all_sales())
  with check (owner_id = auth.uid() or public.can_see_all_sales());

-- ── 7. coach_directives — owner-scoped. ──────────────────────────────────────
create table if not exists public.coach_directives (
  id uuid primary key default gen_random_uuid(),
  lead_id             uuid references public.leads(id) on delete cascade,
  directive           text,
  why                 text,
  suggested_opening   text,
  win_condition       text,
  rank                int,
  score               numeric,
  generated_for       date,
  owner_id            uuid not null references auth.users(id),
  status              text not null default 'pending',  -- 'pending'|'acted'|'dismissed'|'expired'
  acted_interaction_id uuid references public.interactions(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists coach_directives_owner_idx on public.coach_directives (owner_id, generated_for);

alter table public.coach_directives enable row level security;
drop policy if exists coach_directives_owner_all on public.coach_directives;
create policy coach_directives_owner_all on public.coach_directives
  for all
  using      (owner_id = auth.uid() or public.can_see_all_sales())
  with check (owner_id = auth.uid() or public.can_see_all_sales());

-- ── 8. sales_targets — per rep; native amount + currency (display via useFx). ──
create table if not exists public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end   date not null,
  amount       numeric not null,
  currency     text not null default 'GBP',
  owner_id     uuid not null references auth.users(id),
  created_at   timestamptz not null default now()
);
create index if not exists sales_targets_owner_idx on public.sales_targets (owner_id, period_start);

alter table public.sales_targets enable row level security;
drop policy if exists sales_targets_owner_all on public.sales_targets;
create policy sales_targets_owner_all on public.sales_targets
  for all
  using      (owner_id = auth.uid() or public.can_see_all_sales())
  with check (owner_id = auth.uid() or public.can_see_all_sales());

-- ── 9. coach_settings — one row per rep. ─────────────────────────────────────
create table if not exists public.coach_settings (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  intensity           text not null default 'hard',  -- 'direct'|'hard'|'brutal'
  daily_call_target   int not null default 10,
  daily_meeting_target int not null default 2,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.coach_settings enable row level security;
drop policy if exists coach_settings_owner_all on public.coach_settings;
create policy coach_settings_owner_all on public.coach_settings
  for all
  using      (user_id = auth.uid() or public.can_see_all_sales())
  with check (user_id = auth.uid() or public.can_see_all_sales());
