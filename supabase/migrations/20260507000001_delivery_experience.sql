-- Add delivery experience fields to lane_tasks
ALTER TABLE public.lane_tasks
  ADD COLUMN IF NOT EXISTS delivery_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'pending_validation',
  -- pending_validation | in_production | delivered | feedback_received
  ADD COLUMN IF NOT EXISTS feedback_text TEXT,
  ADD COLUMN IF NOT EXISTS feedback_sketch_url TEXT,
  ADD COLUMN IF NOT EXISTS feedback_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requested_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ;

-- Members can read their own tasks' delivery fields (already covered by existing policy)
-- Admins can update delivery_due_at and delivery_status (already covered by admin policy)

-- Index for dashboard query
CREATE INDEX IF NOT EXISTS idx_lane_tasks_delivery
  ON public.lane_tasks(account_id, delivery_status, delivery_due_at);
