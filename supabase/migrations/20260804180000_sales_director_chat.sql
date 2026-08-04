-- Sales Director chat
--
-- A conversational front door to the pipeline. The chat can read freely and
-- write some things directly; the three fields that feed forecasting —
-- stage, value_estimate, owner_id — are queued for the user to confirm.
--
-- AUTHORITY MODEL (Fred's decision, "option C"):
--   free   → create a lead, log an interaction, set a commitment, fill blank
--            contact fields. Cheap to undo, visible when wrong.
--   gated  → stage / value_estimate / owner_id / outcome. Wrong values here
--            don't look like errors, they look like a forecast — so they land
--            in coach_actions as 'pending' and only apply on an explicit click.
--
-- Every write here sets app.event_source='coach' so tg_lead_events attributes
-- it correctly. Nothing this module does is untraceable.

-- ── Conversation ─────────────────────────────────────────────────────────────

create table if not exists public.coach_threads (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id),
  title           text,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.coach_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.coach_threads(id) on delete cascade,
  owner_id   uuid not null references auth.users(id),
  role       text not null check (role in ('user','assistant')),
  -- Display text for the UI.
  body       text,
  -- The verbatim Anthropic content blocks (text / tool_use / tool_result), so a
  -- thread replays to the model exactly as it happened rather than as a
  -- reconstruction. Ordering is by seq, never by created_at — two blocks in the
  -- same tool round can share a timestamp.
  blocks     jsonb,
  seq        bigint generated always as identity,
  created_at timestamptz not null default now()
);

create index if not exists coach_threads_owner_idx  on public.coach_threads (owner_id, last_message_at desc);
create index if not exists coach_messages_thread_idx on public.coach_messages (thread_id, seq);

-- ── Gated writes ─────────────────────────────────────────────────────────────

create table if not exists public.coach_actions (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.coach_threads(id) on delete cascade,
  message_id  uuid references public.coach_messages(id) on delete set null,
  owner_id    uuid not null references auth.users(id),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  kind        text not null check (kind in ('stage_change','value_change','owner_change','outcome_set')),
  from_value  text,
  to_value    text not null,
  reason      text,
  status      text not null default 'pending' check (status in ('pending','confirmed','declined','superseded')),
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists coach_actions_thread_idx  on public.coach_actions (thread_id, created_at);
create index if not exists coach_actions_pending_idx on public.coach_actions (owner_id, status) where status = 'pending';

-- ── RLS: a chat is personal. Owner only — a sales manager does not read
--    someone else's conversation, even though they can see the leads in it. ───

alter table public.coach_threads  enable row level security;
alter table public.coach_messages enable row level security;
alter table public.coach_actions  enable row level security;

drop policy if exists coach_threads_own on public.coach_threads;
create policy coach_threads_own on public.coach_threads
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists coach_messages_own on public.coach_messages;
create policy coach_messages_own on public.coach_messages
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists coach_actions_own on public.coach_actions;
create policy coach_actions_own on public.coach_actions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ── Free writes ──────────────────────────────────────────────────────────────

-- Create a lead. Guards against the obvious failure mode of a chat that can
-- create rows: say a company twice and you get it twice. A case-insensitive
-- name match on a live lead returns the existing row instead of a duplicate.
create or replace function public.sales_coach_create_lead(
  p_company text,
  p_contact_name text default null,
  p_email text default null,
  p_phone text default null,
  p_website text default null,
  p_sector text default null,
  p_country text default null,
  p_notes text default null,
  p_source text default null
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_existing record;
begin
  if coalesce(btrim(p_company),'') = '' then
    raise exception 'company is required';
  end if;

  select id, company, stage into v_existing
  from public.leads
  where lower(btrim(company)) = lower(btrim(p_company))
    and coalesce(outcome,'') not in ('lost','dead')
  order by created_at
  limit 1;

  if found then
    return jsonb_build_object(
      'created', false, 'lead_id', v_existing.id,
      'company', v_existing.company, 'stage', v_existing.stage,
      'note', 'A live lead with that name already exists — returning it instead of creating a duplicate.'
    );
  end if;

  perform set_config('app.event_source', 'coach', true);

  insert into public.leads (company, contact_name, email, phone, website, sector, country, notes, source, owner_id, created_by)
  values (btrim(p_company), nullif(btrim(p_contact_name),''), nullif(btrim(p_email),''),
          nullif(btrim(p_phone),''), nullif(btrim(p_website),''), nullif(btrim(p_sector),''),
          nullif(btrim(p_country),''), nullif(btrim(p_notes),''),
          coalesce(nullif(btrim(p_source),''), 'director'), v_uid, v_uid)
  returning id into v_id;

  return jsonb_build_object('created', true, 'lead_id', v_id, 'company', btrim(p_company), 'stage', 'new');
end $$;

-- Log an interaction. This is what absorbs the debrief: same table, same
-- attribution, reached conversationally instead of through a per-lead form.
create or replace function public.sales_coach_log_interaction(
  p_lead_id uuid,
  p_type text,
  p_direction text default null,
  p_outcome text default null,
  p_summary text default null,
  p_raw text default null,
  p_occurred_at timestamptz default null
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  perform set_config('app.event_source', 'coach', true);

  insert into public.interactions (lead_id, type, direction, outcome, summary, raw_debrief, occurred_at, created_by)
  values (p_lead_id, coalesce(nullif(p_type,''),'other'), nullif(p_direction,''), nullif(p_outcome,''),
          nullif(p_summary,''), nullif(p_raw,''), coalesce(p_occurred_at, now()), v_uid)
  returning id into v_id;

  -- Logging contact is also a fact about the lead: keep last_contacted_at true
  -- so staleness ranking doesn't drift away from what actually happened.
  update public.leads
     set last_contacted_at = greatest(coalesce(last_contacted_at, 'epoch'::timestamptz), coalesce(p_occurred_at, now())),
         stalled_at = null
   where id = p_lead_id;

  return jsonb_build_object('interaction_id', v_id);
end $$;

create or replace function public.sales_coach_set_commitment(
  p_lead_id uuid,
  p_party text,
  p_description text,
  p_due_date date
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare v_id uuid;
begin
  if coalesce(btrim(p_description),'') = '' or p_due_date is null then
    raise exception 'description and due_date are required';
  end if;

  insert into public.commitments (lead_id, party, description, due_date, original_due_date, owner_id)
  values (p_lead_id, coalesce(nullif(p_party,''),'us'), btrim(p_description), p_due_date, p_due_date, auth.uid())
  returning id into v_id;

  update public.leads
     set next_action_at = least(coalesce(next_action_at, p_due_date), p_due_date)
   where id = p_lead_id;

  return jsonb_build_object('commitment_id', v_id);
end $$;

-- Free lead fields only. stage / value_estimate / owner_id / outcome are
-- deliberately absent here — there is no code path that writes them without a
-- confirmed coach_actions row.
create or replace function public.sales_coach_update_lead(
  p_lead_id uuid,
  p_updates jsonb
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_applied text[] := '{}';
  k text;
begin
  perform set_config('app.event_source', 'coach', true);

  foreach k in array array['contact_name','email','phone','website','sector','country','role','segment','notes','next_action_at']
  loop
    if p_updates ? k and nullif(p_updates->>k,'') is not null then
      if k = 'next_action_at' then
        update public.leads set next_action_at = (p_updates->>k)::date where id = p_lead_id;
      else
        execute format('update public.leads set %I = $1 where id = $2', k)
          using p_updates->>k, p_lead_id;
      end if;
      v_applied := v_applied || k;
    end if;
  end loop;

  update public.leads set updated_at = now() where id = p_lead_id;
  return jsonb_build_object('applied', v_applied);
end $$;

-- ── Gated writes ─────────────────────────────────────────────────────────────

-- Queue a change for confirmation. Records the CURRENT value as from_value so
-- the confirm card can show "Qualified → Proposal" rather than just the target,
-- and so a stale card is visible as stale.
create or replace function public.sales_coach_queue_action(
  p_thread_id uuid,
  p_lead_id uuid,
  p_kind text,
  p_to_value text,
  p_reason text default null
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare v_id uuid; v_from text; v_company text;
begin
  select company,
         case p_kind
           when 'stage_change' then stage
           when 'value_change' then value_estimate::text
           when 'owner_change' then owner_id::text
           when 'outcome_set'  then outcome
         end
    into v_company, v_from
  from public.leads where id = p_lead_id;

  if not found then raise exception 'lead not found'; end if;

  -- One pending action per field per lead: a newer proposal supersedes the old
  -- one rather than leaving two contradictory cards to click.
  update public.coach_actions
     set status = 'superseded', resolved_at = now()
   where lead_id = p_lead_id and kind = p_kind and status = 'pending';

  insert into public.coach_actions (thread_id, owner_id, lead_id, kind, from_value, to_value, reason)
  values (p_thread_id, auth.uid(), p_lead_id, p_kind, v_from, p_to_value, nullif(p_reason,''))
  returning id into v_id;

  return jsonb_build_object('action_id', v_id, 'company', v_company, 'from', v_from, 'to', p_to_value, 'status', 'pending');
end $$;

create or replace function public.sales_coach_resolve_action(
  p_action_id uuid,
  p_decision text
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare a record;
begin
  select * into a from public.coach_actions where id = p_action_id and owner_id = auth.uid();
  if not found then raise exception 'action not found'; end if;
  if a.status <> 'pending' then
    return jsonb_build_object('action_id', a.id, 'status', a.status, 'note', 'Already resolved.');
  end if;

  if p_decision <> 'confirm' then
    update public.coach_actions set status = 'declined', resolved_at = now() where id = a.id;
    return jsonb_build_object('action_id', a.id, 'status', 'declined');
  end if;

  perform set_config('app.event_source', 'coach', true);

  if a.kind = 'stage_change' then
    update public.leads set stage = a.to_value, updated_at = now() where id = a.lead_id;
  elsif a.kind = 'value_change' then
    update public.leads set value_estimate = a.to_value::numeric, updated_at = now() where id = a.lead_id;
  elsif a.kind = 'owner_change' then
    update public.leads set owner_id = a.to_value::uuid, updated_at = now() where id = a.lead_id;
  elsif a.kind = 'outcome_set' then
    update public.leads
       set outcome = a.to_value,
           closed_at = coalesce(closed_at, now()),
           updated_at = now()
     where id = a.lead_id;
  end if;

  update public.coach_actions set status = 'confirmed', resolved_at = now() where id = a.id;
  return jsonb_build_object('action_id', a.id, 'status', 'confirmed', 'kind', a.kind, 'to', a.to_value);
end $$;

grant execute on function public.sales_coach_create_lead(text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.sales_coach_log_interaction(uuid,text,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.sales_coach_set_commitment(uuid,text,text,date) to authenticated;
grant execute on function public.sales_coach_update_lead(uuid,jsonb) to authenticated;
grant execute on function public.sales_coach_queue_action(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.sales_coach_resolve_action(uuid,text) to authenticated;
