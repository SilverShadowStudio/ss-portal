ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS pending_lane_count integer,
  ADD COLUMN IF NOT EXISTS pending_monthly_cost_pence integer,
  ADD COLUMN IF NOT EXISTS lane_change_effective_at date,
  ADD COLUMN IF NOT EXISTS lane_change_requested_at timestamptz;