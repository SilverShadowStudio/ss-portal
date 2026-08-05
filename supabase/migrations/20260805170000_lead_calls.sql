-- Call transcripts, and what the Director makes of them.
--
-- Fred records his calls; the transcript lands on the lead, the Director grades
-- the call out of 100 on how he handled it and out of 100 on the chance of
-- winning the work, and says what to do next and by when.
--
-- CONSENT IS RECORDED, NOT ASSUMED. Recording a business call is one thing;
-- processing it to build a profile of the other person engages UK GDPR, and
-- France, Italy and Monaco — all in this pipeline — are stricter than the UK
-- about consent. consent_note carries how it was handled on that call, so the
-- record can answer the question rather than the file being silent.

create table if not exists public.lead_calls (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  owner_id      uuid not null references auth.users(id),

  occurred_at   timestamptz not null default now(),
  duration_seconds integer,
  source        text not null default 'pasted'
                check (source in ('recording', 'dictation', 'pasted')),
  /** How consent was handled — "announced at the start", "UK, one-party", etc. */
  consent_note  text,
  transcript    text not null,

  -- ── What the Director made of it ──────────────────────────────────────────
  /** 0-100. How well Fred handled the call. */
  performance_score integer check (performance_score between 0 and 100),
  /** 0-100. The chance this becomes paid work. */
  win_probability   integer check (win_probability between 0 and 100),
  /** { did_well[], cost_you[], read_of_them, blockers[], actions[{what, by, why}] } */
  assessment    jsonb,
  assessed_at   timestamptz,

  created_at    timestamptz not null default now()
);

create index if not exists lead_calls_lead_idx on public.lead_calls (lead_id, occurred_at desc);
create index if not exists lead_calls_owner_idx on public.lead_calls (owner_id, occurred_at desc);

alter table public.lead_calls enable row level security;

drop policy if exists lead_calls_sales on public.lead_calls;
create policy lead_calls_sales on public.lead_calls
  for all using (owner_id = auth.uid() or public.can_see_all_sales())
  with check (owner_id = auth.uid() or public.can_see_all_sales());

-- The rolling figure shown on every card: the latest assessed probability for
-- that lead. Kept on `leads` so the list can show it without joining every row.
alter table public.leads
  add column if not exists win_probability integer,
  add column if not exists win_probability_at timestamptz;

comment on column public.leads.win_probability is
  'Latest Director assessment of the chance this signs, 0-100. Written only by sales_call_assess — never by hand, so it always traces to a call.';

-- Store an assessment and roll it up onto the lead, in one transaction so a
-- card can never show a probability whose call failed to save.
create or replace function public.sales_call_assess(
  p_call_id uuid,
  p_performance integer,
  p_probability integer,
  p_assessment jsonb
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare v_lead uuid;
begin
  select lead_id into v_lead from public.lead_calls where id = p_call_id;
  if not found then raise exception 'call not found'; end if;

  update public.lead_calls
     set performance_score = p_performance,
         win_probability   = p_probability,
         assessment        = p_assessment,
         assessed_at       = now()
   where id = p_call_id;

  -- Attribute the write like any other coach action.
  perform set_config('app.event_source', 'coach', true);
  update public.leads
     set win_probability = p_probability,
         win_probability_at = now(),
         updated_at = now()
   where id = v_lead;

  return jsonb_build_object('call_id', p_call_id, 'lead_id', v_lead, 'win_probability', p_probability);
end $$;

grant execute on function public.sales_call_assess(uuid,integer,integer,jsonb) to authenticated;
