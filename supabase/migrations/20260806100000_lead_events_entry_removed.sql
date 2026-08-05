-- A removal deserves its own event type. It was being written as 'outcome_set'
-- because the CHECK didn't allow anything better, and it rendered in the
-- history as a bare "outcome set" that said nothing.
alter table public.lead_events drop constraint if exists lead_events_event_type_check;
alter table public.lead_events add constraint lead_events_event_type_check
  check (event_type = any (array['created','stage_change','outcome_set','owner_change','value_change','entry_removed']));

-- Re-label the ones already written that way: a removal always records what it
-- removed in to_value, so they're identifiable without guessing.
update public.lead_events set event_type = 'entry_removed'
 where event_type = 'outcome_set' and to_value = 'removed';

create or replace function public.sales_delete_entry(p_kind text, p_id uuid)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_lead uuid; v_what text;
begin
  if p_kind = 'interaction' then
    select lead_id, coalesce(summary, left(coalesce(raw_debrief,''), 90), type)
      into v_lead, v_what from public.interactions where id = p_id;
    if not found then raise exception 'interaction not found'; end if;
    delete from public.interactions where id = p_id;
  elsif p_kind = 'commitment' then
    select lead_id, description into v_lead, v_what from public.commitments where id = p_id;
    if not found then raise exception 'commitment not found'; end if;
    delete from public.commitments where id = p_id;
  else
    raise exception 'kind must be interaction or commitment';
  end if;

  perform set_config('app.event_source', 'ui', true);
  insert into public.lead_events (lead_id, event_type, from_value, to_value, actor_id, source)
  values (v_lead, 'entry_removed', p_kind, left(coalesce(v_what,''), 120), auth.uid(), 'ui');

  return jsonb_build_object('deleted', p_kind, 'lead_id', v_lead);
end $$;

select 'entry_removed events: '||count(*)::text as d from public.lead_events where event_type='entry_removed';
