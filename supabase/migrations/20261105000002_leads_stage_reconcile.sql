-- ⚠️ DESTRUCTIVE (updates existing rows) — NEEDS FRED'S SIGN-OFF BEFORE IT RUNS.
--
-- One pipeline field. Until 5 Nov 2026 the Sales list edited `leads.status`
-- while the Director, the debrief, the lead history and the KPIs all read
-- `leads.stage`, so the two drifted apart. The list now writes `stage`. This
-- brings existing rows into line, once, so the history starts from the truth.
--
-- Rule, per lead where the two disagree (status mapped onto the stage keys:
-- replied→engaged, meeting→qualified, the rest by name):
--   • status says Won or Lost and stage is still open → take status
--     (Fred closed it in the list; the list was the only place he did).
--   • otherwise take whichever of the two is further along the pipeline.
--   • a lead that ends up Won/Lost with no outcome gets the outcome and a
--     closed_at, which the Director's pipeline figures go by.
-- Every change is written to lead_events with source 'migration', so it is
-- visible in each lead's history and can be reversed from there.
--
-- Run the PREVIEW first; it changes nothing and lists exactly what would move.

-- ── PREVIEW (read-only) ────────────────────────────────────────────────────
-- with mapped as (
--   select l.id, l.company, l.status, l.stage,
--          case l.status when 'replied' then 'engaged' when 'meeting' then 'qualified' else l.status end as status_as_stage
--   from public.leads l
-- )
-- select m.company, m.status, m.stage as stage_now,
--        case
--          when m.status_as_stage in ('won','lost') and m.stage not in ('won','lost','dead') then m.status_as_stage
--          when ps.sort_order > pc.sort_order then m.status_as_stage
--          else m.stage
--        end as stage_after
-- from mapped m
-- join public.pipeline_stages pc on pc.key = m.stage
-- join public.pipeline_stages ps on ps.key = m.status_as_stage
-- where m.status_as_stage is distinct from m.stage
-- order by m.company;

begin;

select set_config('app.event_source', 'migration', true);

with mapped as (
  select l.id, l.stage,
         case l.status when 'replied' then 'engaged' when 'meeting' then 'qualified' else l.status end as status_as_stage
  from public.leads l
),
decided as (
  select m.id,
         case
           when m.status_as_stage in ('won','lost') and m.stage not in ('won','lost','dead') then m.status_as_stage
           when ps.sort_order > pc.sort_order then m.status_as_stage
           else m.stage
         end as new_stage
  from mapped m
  join public.pipeline_stages pc on pc.key = m.stage
  join public.pipeline_stages ps on ps.key = m.status_as_stage
  where m.status_as_stage is distinct from m.stage
)
update public.leads l
   set stage = d.new_stage,
       updated_at = now()
  from decided d
 where l.id = d.id
   and l.stage is distinct from d.new_stage;

-- Closed stages carry an outcome; the trigger logs it as outcome_set.
update public.leads
   set outcome = stage,
       closed_at = coalesce(closed_at, now()),
       updated_at = now()
 where stage in ('won','lost','dead')
   and outcome is null;

commit;
