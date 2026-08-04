-- Sales Director — schema (Task 1). Multi-rep from day one: owner_id NOT NULL,
-- coach layer scoped per rep via RLS (owner_id = auth.uid() OR is_admin()).
-- RLS pattern follows 20260731000001_leads.sql. Margin is built with a clean
-- seam (manual/segment-default now; a future Airtable sync can populate it).

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. is_admin() helper — written once, reused by every policy below.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'::app_role
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. pipeline_stages (lookup, seeded). Stages are data — add via row insert.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pipeline_stages (
  key         text primary key,
  label       text not null,
  sort_order  int  not null,
  probability numeric not null,          -- 0..1, used by the ranker; seed estimates, tune later
  is_terminal boolean not null default false,
  is_active   boolean not null default true
);

insert into public.pipeline_stages (key, label, sort_order, probability, is_terminal) values
  ('new',         'New',         10, 0.05, false),
  ('contacted',   'Contacted',   20, 0.10, false),
  ('engaged',     'Engaged',     30, 0.20, false),
  ('qualified',   'Qualified',   40, 0.35, false),
  ('proposal',    'Proposal',    50, 0.50, false),
  ('negotiation', 'Negotiation', 60, 0.70, false),
  ('won',         'Won',         70, 1.00, true),
  ('lost',        'Lost',        80, 0.00, true),
  ('dead',        'Dead',        90, 0.00, true)
on conflict (key) do nothing;

alter table public.pipeline_stages enable row level security;
drop policy if exists pipeline_stages_admin_read on public.pipeline_stages;
create policy pipeline_stages_admin_read on public.pipeline_stages
  for select using (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. leads — extend (do not drop anything). Backfill BEFORE the audit trigger
--    exists so the migration itself doesn't emit stage-change events.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.leads
  add column if not exists stage                text references public.pipeline_stages(key),
  add column if not exists outcome              text,   -- 'won' | 'lost' | 'dead' | null
  add column if not exists loss_reason          text,   -- free text, coach-extracted
  add column if not exists loss_reason_category text,   -- 'price'|'timing'|'no_budget'|'competitor'|'no_decision'|'wrong_fit'|'ghosted'|'other'
  add column if not exists closed_at            timestamptz,
  add column if not exists expected_margin_pct  numeric,   -- forecast at qualification (manual / segment default)
  add column if not exists actual_margin_pct    numeric,   -- computed on close: invoices − payables
  add column if not exists margin_source        text,      -- seam: 'manual'|'segment_default'|'airtable'|'computed'
  add column if not exists owner_id             uuid references auth.users(id),
  add column if not exists converted_account_id uuid references public.accounts(id),
  add column if not exists stalled_at           timestamptz,
  add column if not exists import_source        text,
  add column if not exists import_row_hash      text;

-- Backfill stage/outcome from the legacy flat status.
update public.leads set stage = 'won',  outcome = 'won' where status = 'won'  and stage is null;
update public.leads set stage = 'new'                    where stage is null;
alter table public.leads alter column stage set default 'new';
alter table public.leads alter column stage set not null;

-- Backfill owner_id to the current sole admin, then enforce NOT NULL.
update public.leads
  set owner_id = (select ur.user_id from public.user_roles ur where ur.role = 'admin'::app_role limit 1)
  where owner_id is null;
alter table public.leads alter column owner_id set not null;

-- Idempotent re-import guard (addendum §4.4).
create unique index if not exists leads_import_row_hash_uq
  on public.leads (import_row_hash) where import_row_hash is not null;
create index if not exists leads_stage_idx        on public.leads (stage);
create index if not exists leads_owner_idx         on public.leads (owner_id);
create index if not exists leads_next_action_idx   on public.leads (next_action_at);
create index if not exists leads_stalled_idx       on public.leads (stalled_at);

-- leads RLS is unchanged: the existing leads_admin_all policy already lets every
-- admin (= every rep) see the whole pipeline. Per-rep scoping is on the coach
-- layer below, not the lead table (per spec §1.2).

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. contacts (addendum §2.1) — one row per person; multi-threading is coachable.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.contacts (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  name text, title text, email text, phone text, linkedin text,
  role_type  text,      -- 'champion'|'blocker'|'economic_buyer'|'gatekeeper'|'unknown'
  is_primary boolean default false,
  created_at timestamptz default now()
);
create index if not exists contacts_lead_idx on public.contacts (lead_id);

alter table public.contacts enable row level security;
drop policy if exists contacts_admin_all on public.contacts;
create policy contacts_admin_all on public.contacts
  for all using (public.is_admin()) with check (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. lead_events (immutable audit) + trigger on leads.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.lead_events (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  event_type text not null,   -- 'created'|'stage_change'|'outcome_set'|'owner_change'|'value_change'
  from_value text,
  to_value   text,
  actor_id   uuid,
  source     text not null default 'ui',  -- 'ui'|'coach'|'import'|'system'
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
create trigger trg_lead_events
  after insert or update on public.leads
  for each row execute function public.tg_lead_events();

alter table public.lead_events enable row level security;
drop policy if exists lead_events_admin_read on public.lead_events;
create policy lead_events_admin_read on public.lead_events
  for select using (public.is_admin());
drop policy if exists lead_events_admin_insert on public.lead_events;
create policy lead_events_admin_insert on public.lead_events
  for insert with check (public.is_admin());
-- no update/delete policy → append-only audit.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. interactions (one row per touch) + last_contacted_at / un-stall trigger.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.interactions (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  contact_id  uuid references public.contacts(id) on delete set null,
  type        text not null,   -- 'call'|'email'|'meeting'|'linkedin'|'whatsapp'|'other'
  direction   text,            -- 'outbound'|'inbound'
  outcome     text,            -- 'no_answer'|'left_message'|'spoke'|'meeting_booked'|'pushed'|'objection'|'dead'|'other'
  summary     text,            -- LLM-normalised
  raw_debrief text,            -- exactly what the rep typed. NEVER discard.
  objection   text,            -- extracted, nullable
  occurred_at timestamptz not null default now(),
  created_by  uuid,
  created_at  timestamptz not null default now()
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
create trigger trg_interaction_touch
  after insert on public.interactions
  for each row execute function public.tg_interaction_touch();

alter table public.interactions enable row level security;
drop policy if exists interactions_admin_all on public.interactions;
create policy interactions_admin_all on public.interactions
  for all using (public.is_admin()) with check (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. commitments (the spine) — owner-scoped.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.commitments (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.leads(id) on delete cascade,
  interaction_id   uuid references public.interactions(id) on delete set null,
  party            text not null,   -- 'us'|'them'
  description      text not null,
  due_date         date not null,
  status           text not null default 'open',  -- 'open'|'kept'|'missed'|'cancelled'
  owner_id         uuid not null references auth.users(id),
  slip_count       int  not null default 0,
  original_due_date date,
  completed_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists commitments_lead_idx  on public.commitments (lead_id);
create index if not exists commitments_owner_idx  on public.commitments (owner_id, status, due_date);

alter table public.commitments enable row level security;
drop policy if exists commitments_owner_all on public.commitments;
create policy commitments_owner_all on public.commitments
  for all using (owner_id = auth.uid() or public.is_admin())
          with check (owner_id = auth.uid() or public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. coach_directives — owner-scoped.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.coach_directives (
  id                  uuid primary key default gen_random_uuid(),
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
  for all using (owner_id = auth.uid() or public.is_admin())
          with check (owner_id = auth.uid() or public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. sales_targets — per rep. Native amount + currency, displayed via useFx.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.sales_targets (
  id           uuid primary key default gen_random_uuid(),
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
  for all using (owner_id = auth.uid() or public.is_admin())
          with check (owner_id = auth.uid() or public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. coach_settings — one row per rep.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.coach_settings (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  intensity           text not null default 'hard',  -- 'direct'|'hard'|'brutal'
  daily_call_target   int  not null default 10,
  daily_meeting_target int not null default 2,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.coach_settings enable row level security;
drop policy if exists coach_settings_owner_all on public.coach_settings;
create policy coach_settings_owner_all on public.coach_settings
  for all using (user_id = auth.uid() or public.is_admin())
          with check (user_id = auth.uid() or public.is_admin());
