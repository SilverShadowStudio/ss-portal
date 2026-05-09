ALTER TABLE public.lane_tasks
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS duration_days numeric NOT NULL DEFAULT 1;