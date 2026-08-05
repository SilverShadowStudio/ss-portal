-- Reminders — the PA's whole memory.
--
-- Fred taps the bubble, says or types one line, presses enter and forgets it.
-- Deliberately NOT a conversation: there is no thread and nothing to come back
-- to. The reminder is the artefact.
--
-- google_event_id is here from the start so the Google mirror is a fill-in
-- rather than a migration later. It stays null until OAuth exists.

create table if not exists public.reminders (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id),

  /** What to show him, in his own words where possible. */
  body          text not null,
  due_at        timestamptz not null,
  /** Exactly what he said, kept so a mis-parsed time can be understood later. */
  raw_text      text,

  /** Set when he clicks the acknowledgement — the alarm only stops for that. */
  acknowledged_at timestamptz,
  /** Set if he clears it before it ever fires. */
  cancelled_at  timestamptz,

  google_event_id text,
  created_at    timestamptz not null default now()
);

-- The alarm poll asks one question — "anything of mine due and not yet
-- acknowledged?" — so that's the index.
create index if not exists reminders_due_idx
  on public.reminders (owner_id, due_at)
  where acknowledged_at is null and cancelled_at is null;

alter table public.reminders enable row level security;

drop policy if exists reminders_own on public.reminders;
create policy reminders_own on public.reminders
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
