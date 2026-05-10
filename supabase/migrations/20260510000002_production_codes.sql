-- Add production codes to projects and scenes for automatic Dropbox path resolution.
-- Format: CP107_Charles-Street / SC05_Facade
-- The app builds the Dropbox path from these codes automatically.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS project_code TEXT,  -- e.g. CP107
  ADD COLUMN IF NOT EXISTS project_slug TEXT;  -- e.g. Charles-Street (the part after the underscore)

ALTER TABLE public.scenes
  ADD COLUMN IF NOT EXISTS scene_code TEXT,    -- e.g. SC05
  ADD COLUMN IF NOT EXISTS scene_slug TEXT;    -- e.g. Facade (the part after the underscore)

-- Indexes for fast path lookups
CREATE INDEX IF NOT EXISTS idx_projects_project_code ON public.projects(project_code) WHERE project_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scenes_scene_code ON public.scenes(scene_code) WHERE scene_code IS NOT NULL;

-- Helper function: build the VS_Visuals Dropbox path for a scene
-- Returns e.g. /00_Production/PRD01_Client-Projects/CP107_Charles-Street/SC05_Facade/VS_Visuals
CREATE OR REPLACE FUNCTION public.scene_dropbox_visuals_path(p_scene_id UUID)
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT 
    '/00_Production/PRD01_Client-Projects/' ||
    p.project_code || '_' || p.project_slug || '/' ||
    s.scene_code || '_' || s.scene_slug || '/VS_Visuals'
  FROM public.scenes s
  JOIN public.projects p ON p.id = s.project_id
  WHERE s.id = p_scene_id
    AND p.project_code IS NOT NULL
    AND p.project_slug IS NOT NULL
    AND s.scene_code IS NOT NULL
    AND s.scene_slug IS NOT NULL
$$;
