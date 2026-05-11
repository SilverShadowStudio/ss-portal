-- Add delivery_due_at to scene_rounds (sourced from Airtable Deadline field)
ALTER TABLE public.scene_rounds
  ADD COLUMN IF NOT EXISTS delivery_due_at TIMESTAMPTZ;

-- Extend status constraint to include awaiting_review
ALTER TABLE public.scene_rounds
  DROP CONSTRAINT IF EXISTS scene_rounds_status_check;

ALTER TABLE public.scene_rounds
  ADD CONSTRAINT scene_rounds_status_check
  CHECK (status IN ('pending', 'in_production', 'delivered', 'approved', 'client_review', 'awaiting_review'));
