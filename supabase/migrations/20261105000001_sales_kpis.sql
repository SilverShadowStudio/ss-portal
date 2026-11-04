-- Monthly sales KPIs per person (additive: one new function, nothing altered).
--
-- The figures a monthly review is held against, counted from the CRM rather
-- than remembered. Schedule 3 of the business development agreement names the
-- same indicators, so the page and the contract use one vocabulary.
--
-- Attribution is by the LEAD's owner, the same rule commission uses: activity
-- on Isabella's leads is Isabella's. Window is [p_from, p_to): p_to exclusive.
--
--   outreach       interactions going out (direction outbound, or not recorded),
--                  excluding meetings themselves
--   replies        interactions coming in (direction inbound)
--   meetings       interactions whose outcome was 'meeting_booked'
--   opportunities  leads that crossed into Qualified or later during the window
--                  (a stage_change from New/Contacted/Engaged to Qualified,
--                  Proposal, Negotiation or Won): handed over for a proposal
--   pipeline_value open leads' estimated value NOW (a snapshot, not the value
--                  at the end of the window, which the data cannot reconstruct)
--   signed_*       leads marked Won during the window, and their value
--
-- SECURITY INVOKER on purpose: it runs under the caller's RLS, so a rep gets
-- one row (her own) and an admin or sales manager gets everyone. No new
-- visibility is created by this function.

create or replace function public.sales_kpis(p_from date, p_to date)
returns table (
  owner_id        uuid,
  owner_name      text,
  outreach        integer,
  replies         integer,
  meetings        integer,
  opportunities   integer,
  pipeline_value  numeric,
  signed_count    integer,
  signed_value    numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with owners as (
    select distinct l.owner_id from public.leads l
  ),
  acts as (
    select l.owner_id,
           count(*) filter (where coalesce(i.direction, 'outbound') = 'outbound' and i.type <> 'meeting') as outreach,
           count(*) filter (where i.direction = 'inbound')                                               as replies,
           count(*) filter (where i.outcome = 'meeting_booked')                                          as meetings
      from public.interactions i
      join public.leads l on l.id = i.lead_id
     where i.occurred_at >= p_from and i.occurred_at < p_to
     group by l.owner_id
  ),
  opps as (
    select l.owner_id, count(distinct e.lead_id) as n
      from public.lead_events e
      join public.leads l on l.id = e.lead_id
     where e.event_type = 'stage_change'
       and e.created_at >= p_from and e.created_at < p_to
       and e.to_value in ('qualified', 'proposal', 'negotiation', 'won')
       and coalesce(e.from_value, 'new') in ('new', 'contacted', 'engaged')
     group by l.owner_id
  ),
  signed as (
    select l.owner_id, count(*) as n, sum(coalesce(l.value_estimate, 0)) as v
      from public.leads l
     where exists (
             select 1 from public.lead_events e
              where e.lead_id = l.id
                and e.created_at >= p_from and e.created_at < p_to
                and ((e.event_type = 'stage_change' and e.to_value = 'won')
                  or (e.event_type = 'outcome_set'  and e.to_value = 'won')))
     group by l.owner_id
  ),
  pipe as (
    select l.owner_id, sum(coalesce(l.value_estimate, 0)) as v
      from public.leads l
     where l.outcome is null and l.stage not in ('won', 'lost', 'dead')
     group by l.owner_id
  )
  select o.owner_id,
         coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), nullif(btrim(p.full_name), ''), 'Unassigned') as owner_name,
         coalesce(a.outreach, 0)::int,
         coalesce(a.replies, 0)::int,
         coalesce(a.meetings, 0)::int,
         coalesce(op.n, 0)::int,
         coalesce(pi.v, 0),
         coalesce(s.n, 0)::int,
         coalesce(s.v, 0)
    from owners o
    left join public.profiles p on p.user_id = o.owner_id
    left join acts   a  on a.owner_id  = o.owner_id
    left join opps   op on op.owner_id = o.owner_id
    left join signed s  on s.owner_id  = o.owner_id
    left join pipe   pi on pi.owner_id = o.owner_id
   order by owner_name;
$$;

grant execute on function public.sales_kpis(date, date) to authenticated;
