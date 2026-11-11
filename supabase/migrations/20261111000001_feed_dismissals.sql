-- Feed dismissals — one table for every "recent things" list in the portal.
--
-- Fred, 11 Nov 2026: every such list (the activity log, the Dropzone's history,
-- and any added later) works the same way — a fixed scrolling window, click a
-- line to clear it from YOUR view, the title brings the whole history back.
-- What each person has cleared is remembered here, per list (`feed`), so it
-- holds across devices and sessions. The activity log keeps its older table
-- (activity_log_dismissals); new lists use this one.
--
-- ADDITIVE: a new table with its own policy. Nothing existing is touched.

create table if not exists public.feed_dismissals (
  user_id    uuid not null references auth.users(id) on delete cascade,
  feed       text not null,
  item_id    text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, feed, item_id)
);

alter table public.feed_dismissals enable row level security;

drop policy if exists feed_dismissals_own on public.feed_dismissals;
create policy feed_dismissals_own on public.feed_dismissals
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, delete on public.feed_dismissals to authenticated;
