-- Teardown for the Sales Director schema (20260804139000 + 20260804140000).
-- NOT a migration — kept out of supabase/migrations/ so it never auto-applies.
-- Run manually only to fully undo a SUCCESSFUL apply. Order matters: drop the
-- objects that reference the leads columns before dropping the columns.
--
-- CANNOT be fully reversed: the two app_role enum values ('sales','sales_manager')
-- cannot be removed (Postgres has no DROP VALUE). They remain, unused and harmless.

begin;

-- 1. Trigger + policy on the KEPT table (leads).
drop trigger if exists trg_lead_events on public.leads;
drop policy  if exists leads_sales_visibility on public.leads;

-- Restore the original admin-only leads policy (from 20260731000001_leads.sql).
drop policy if exists leads_admin_all on public.leads;
create policy leads_admin_all on public.leads
  for all
  using      (exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'::app_role))
  with check (exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'::app_role));

-- 2. Drop the new tables (cascade removes their policies, indexes, FKs, and the
--    trg_interaction_touch trigger that lives on interactions).
drop table if exists public.coach_settings    cascade;
drop table if exists public.sales_targets      cascade;
drop table if exists public.coach_directives   cascade;
drop table if exists public.commitments        cascade;
drop table if exists public.interactions       cascade;
drop table if exists public.lead_events        cascade;
drop table if exists public.contacts           cascade;

-- 3. Drop the columns added to leads (now nothing references them). Dropping
--    `stage` removes its FK to pipeline_stages, so pipeline_stages can go next.
alter table public.leads
  drop column if exists stage,
  drop column if exists outcome,
  drop column if exists loss_reason,
  drop column if exists loss_reason_category,
  drop column if exists closed_at,
  drop column if exists expected_margin_pct,
  drop column if exists actual_margin_pct,
  drop column if exists margin_source,
  drop column if exists owner_id,
  drop column if exists converted_account_id,
  drop column if exists stalled_at,
  drop column if exists import_source,
  drop column if exists import_row_hash;

-- 4. Now the stage lookup can be dropped.
drop table if exists public.pipeline_stages cascade;

-- 5. Functions. (trg_coach_settings_touch drops with the coach_settings table.)
drop function if exists public.tg_lead_events();
drop function if exists public.tg_interaction_touch();
drop function if exists public.tg_touch_updated_at();
drop function if exists public.can_see_all_sales();

commit;
