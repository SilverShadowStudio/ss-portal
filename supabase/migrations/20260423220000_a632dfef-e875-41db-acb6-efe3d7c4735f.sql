-- Add a sort_order column to scenes for manual reordering
ALTER TABLE public.scenes
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill: assign ascending sort_order per project based on creation date
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn
  FROM public.scenes
)
UPDATE public.scenes s
SET sort_order = ordered.rn
FROM ordered
WHERE s.id = ordered.id;

-- Index for ordered listing per project
CREATE INDEX IF NOT EXISTS idx_scenes_project_sort
  ON public.scenes (project_id, sort_order);