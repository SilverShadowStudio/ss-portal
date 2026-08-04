-- Atomic debrief writer. One function call = one transaction, so:
--   * set_config('app.event_source','coach', true) is TRANSACTION-LOCAL and is
--     guaranteed to be set for the UPDATE that fires tg_lead_events (the call-site
--     contract documented on that trigger). Never leaks across pooled requests.
--   * a partial debrief can't land (interaction saved but commitment lost).
--
-- SECURITY INVOKER (default): RLS applies as the calling rep, so a 'sales' rep can
-- only write against a lead they own. The edge function does the confidence /
-- verbatim-evidence gating BEFORE calling this; anything passed here is already
-- approved for writing. p_apply_stage / p_apply_outcome are null when not applied.
create or replace function public.sales_apply_debrief(
  p_lead_id               uuid,
  p_raw_debrief           text,
  p_parse                 jsonb,
  p_interaction           jsonb,
  p_apply_stage           text default null,
  p_apply_outcome         text default null,
  p_loss_reason           text default null,
  p_loss_reason_category  text default null,
  p_lead_updates          jsonb default '{}'::jsonb,
  p_commitments           jsonb default '[]'::jsonb,
  p_commitments_resolved  jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_interaction_id uuid;
  v_uid uuid := auth.uid();
  c jsonb;
begin
  -- Attribute every audit row written in this transaction to the coach.
  perform set_config('app.event_source', 'coach', true);

  -- 1. The interaction ALWAYS lands — raw_debrief verbatim, full parse logged.
  insert into public.interactions
    (lead_id, contact_id, type, direction, outcome, summary, raw_debrief, objection, created_by, parse_json)
  values (
    p_lead_id,
    nullif(p_interaction->>'contact_id','')::uuid,
    coalesce(nullif(p_interaction->>'type',''), 'other'),
    nullif(p_interaction->>'direction',''),
    nullif(p_interaction->>'outcome',''),
    nullif(p_interaction->>'summary',''),
    p_raw_debrief,
    nullif(p_interaction->>'objection',''),
    v_uid,
    p_parse
  )
  returning id into v_interaction_id;

  -- 2. Stage / outcome — only ever non-null when the edge function's gate passed.
  if p_apply_stage is not null then
    update public.leads set stage = p_apply_stage where id = p_lead_id;
  end if;
  if p_apply_outcome is not null then
    update public.leads
      set outcome = p_apply_outcome,
          loss_reason = coalesce(p_loss_reason, loss_reason),
          loss_reason_category = coalesce(p_loss_reason_category, loss_reason_category),
          closed_at = coalesce(closed_at, now())
      where id = p_lead_id;
  end if;

  -- 3. Gated lead field updates (blank-fill only — never overwrite existing data).
  if p_lead_updates ? 'contact_name' and nullif(p_lead_updates->>'contact_name','') is not null then
    update public.leads set contact_name = p_lead_updates->>'contact_name'
      where id = p_lead_id and coalesce(btrim(contact_name),'') = '';
  end if;
  if p_lead_updates ? 'role' and nullif(p_lead_updates->>'role','') is not null then
    update public.leads set role = p_lead_updates->>'role'
      where id = p_lead_id and coalesce(btrim(role),'') = '';
  end if;
  if p_lead_updates ? 'value_estimate' and nullif(p_lead_updates->>'value_estimate','') is not null then
    update public.leads set value_estimate = (p_lead_updates->>'value_estimate')::numeric
      where id = p_lead_id;
  end if;

  -- 4. New commitments.
  for c in select * from jsonb_array_elements(coalesce(p_commitments,'[]'::jsonb)) loop
    if nullif(c->>'description','') is not null and nullif(c->>'due_date','') is not null then
      insert into public.commitments
        (lead_id, interaction_id, party, description, due_date, owner_id, original_due_date)
      values (
        p_lead_id, v_interaction_id,
        coalesce(nullif(c->>'party',''), 'us'),
        c->>'description',
        (c->>'due_date')::date,
        v_uid,
        (c->>'due_date')::date
      );
    end if;
  end loop;

  -- 5. Resolve existing commitments (RLS still scopes this to the rep's own rows).
  for c in select * from jsonb_array_elements(coalesce(p_commitments_resolved,'[]'::jsonb)) loop
    if nullif(c->>'id','') is not null then
      update public.commitments
        set status = coalesce(nullif(c->>'status',''), 'kept'),
            completed_at = case when coalesce(nullif(c->>'status',''),'kept') = 'kept' then now() else completed_at end
        where id = (c->>'id')::uuid;
    end if;
  end loop;

  return jsonb_build_object(
    'interaction_id', v_interaction_id,
    'applied_stage', p_apply_stage,
    'applied_outcome', p_apply_outcome
  );
end $$;

revoke all on function public.sales_apply_debrief(uuid,text,jsonb,jsonb,text,text,text,text,jsonb,jsonb,jsonb) from public;
grant execute on function public.sales_apply_debrief(uuid,text,jsonb,jsonb,text,text,text,text,jsonb,jsonb,jsonb) to authenticated;
