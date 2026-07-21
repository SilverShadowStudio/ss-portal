-- Overhead Drop Zone — Pass 3 (frontend): realtime for filed-state updates
--
-- Adds public.overheads to the supabase_realtime publication so the
-- AdminExpenses page can subscribe to INSERT/UPDATE/DELETE events and reflect
-- the filed state ("Filing to Dropbox…" → filed with dropbox_path) without
-- a manual reload. RLS on public.overheads is admin-only, so realtime
-- respects that — non-admin sessions never receive events.

ALTER PUBLICATION supabase_realtime ADD TABLE public.overheads;
