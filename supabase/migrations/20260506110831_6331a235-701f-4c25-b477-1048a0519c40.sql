ALTER TABLE public.lane_tasks
  ADD COLUMN IF NOT EXISTS requested_delivery_date date,
  ALTER COLUMN lane_index DROP NOT NULL,
  ALTER COLUMN position DROP NOT NULL;