alter table public.leads add column if not exists phone text;
alter table public.leads add column if not exists segment text;   -- Fred's own grouping (CONTACT NOW / CURRENT / DEAD…)
alter table public.leads add column if not exists call_script text;
