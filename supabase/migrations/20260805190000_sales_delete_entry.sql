-- Removing a wrong entry. The Director can write history and, until now,
-- nothing could take a mistaken line back out — which made a helpful entry
-- Fred didn't want a permanent error in the record he relies on.
--
-- Deletion is deliberately NOT given to the Director. It writes; only Fred
-- removes. Anything deleted leaves a trace on the lead, so the history can
-- never quietly lose a line without saying so.
create or replace function public.sales_delete_entry(
  p_kind text,
  p_id uuid
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare v_lead uuid; v_what text;
begin
  if p_kind = 'interaction' then
    select lead_id, coalesce(summary, left(coalesce(raw_debrief,''), 80), type)
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
  values (v_lead, 'outcome_set', left(coalesce(v_what,''), 120), 'removed', auth.uid(), 'ui');

  return jsonb_build_object('deleted', p_kind, 'lead_id', v_lead);
end $$;

grant execute on function public.sales_delete_entry(text,uuid) to authenticated;
