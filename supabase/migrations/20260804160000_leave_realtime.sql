-- Put team_leave_requests on the realtime publication so the admin sidebar's
-- pending-leave badge updates the moment someone requests a day, rather than
-- waiting up to 60s for the poll. Guarded: adding twice errors.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'team_leave_requests'
  ) then
    alter publication supabase_realtime add table public.team_leave_requests;
  end if;
end $$;
