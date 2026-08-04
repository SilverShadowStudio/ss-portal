-- Sales Director memory
--
-- Two layers, deliberately separate:
--
-- 1. coach_threads.summary — a rolling summary of the OLD part of one
--    conversation. Lets a thread run indefinitely without the beginning
--    silently falling out of the replay window.
--
-- 2. coach_brief — one standing brief per user, carried across every thread.
--    This is what makes the Director sharper over time: how Fred works, what
--    he's said about the market, who the recurring people are, decisions
--    already taken.
--
-- WHAT THE BRIEF MUST NOT HOLD: anything the tools return live — stages,
-- values, counts, who's gone cold. Cached pipeline facts go stale and would
-- have the Director confidently quoting last month's numbers. The brief is for
-- things that stay true.

alter table public.coach_threads
  add column if not exists summary text,
  add column if not exists summary_through_seq bigint not null default 0;

comment on column public.coach_threads.summary is
  'Rolling summary of messages up to summary_through_seq. Replaces them in the model replay.';

create table if not exists public.coach_brief (
  owner_id   uuid primary key references auth.users(id),
  brief      text not null default '',
  -- Set when Fred edits it by hand, so an automatic update never silently
  -- overwrites something he wrote deliberately without it being visible.
  edited_by_user boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.coach_brief enable row level security;

drop policy if exists coach_brief_own on public.coach_brief;
create policy coach_brief_own on public.coach_brief
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
