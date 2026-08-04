-- Commitments: resolve or reschedule
--
-- A commitment that gets pushed is the single most useful signal in the whole
-- pipeline — a deal whose date has moved four times is not a live deal, whatever
-- stage it says it's in. So rescheduling increments slip_count and preserves
-- original_due_date rather than quietly rewriting the date and losing the fact
-- that it ever moved.

create or replace function public.sales_commitment_update(
  p_id uuid,
  p_status text default null,
  p_due_date date default null
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare c record;
begin
  select * into c from public.commitments where id = p_id;
  if not found then raise exception 'commitment not found'; end if;

  if p_due_date is not null and p_due_date <> c.due_date then
    update public.commitments
       set due_date = p_due_date,
           original_due_date = coalesce(original_due_date, c.due_date),
           slip_count = slip_count + 1
     where id = p_id;
  end if;

  if p_status is not null then
    update public.commitments
       set status = p_status,
           completed_at = case when p_status = 'kept' then now() else null end
     where id = p_id;
  end if;

  select * into c from public.commitments where id = p_id;
  return jsonb_build_object(
    'id', c.id, 'status', c.status, 'due_date', c.due_date,
    'slip_count', c.slip_count, 'original_due_date', c.original_due_date
  );
end $$;

grant execute on function public.sales_commitment_update(uuid,text,date) to authenticated;
