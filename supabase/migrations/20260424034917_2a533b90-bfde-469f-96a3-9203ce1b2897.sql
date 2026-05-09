-- 1) Add `kind` column to scene_rounds: 'production' (default) or 'review'.
ALTER TABLE public.scene_rounds
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'production';

ALTER TABLE public.scene_rounds
  DROP CONSTRAINT IF EXISTS scene_rounds_kind_check;

ALTER TABLE public.scene_rounds
  ADD CONSTRAINT scene_rounds_kind_check
  CHECK (kind IN ('production', 'review'));

-- 2) Extend status check to include 'client_review'.
ALTER TABLE public.scene_rounds
  DROP CONSTRAINT IF EXISTS scene_rounds_status_check;

ALTER TABLE public.scene_rounds
  ADD CONSTRAINT scene_rounds_status_check
  CHECK (status IN ('pending', 'in_production', 'delivered', 'approved', 'client_review'));

-- 3) Helpful index for the (scene_id, round_number, kind) lookups we now do.
CREATE INDEX IF NOT EXISTS scene_rounds_scene_round_kind_idx
  ON public.scene_rounds (scene_id, round_number, kind);