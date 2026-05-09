ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS archive_reason text;

CREATE INDEX IF NOT EXISTS idx_projects_archived_at ON public.projects(archived_at);

DROP POLICY IF EXISTS "Members can view account projects" ON public.projects;
CREATE POLICY "Members can view account projects"
ON public.projects FOR SELECT TO authenticated
USING (
  account_id IS NOT NULL
  AND is_account_member(account_id)
  AND archived_at IS NULL
);

DROP POLICY IF EXISTS "Members can update account projects" ON public.projects;
CREATE POLICY "Members can update account projects"
ON public.projects FOR UPDATE TO authenticated
USING (
  account_id IS NOT NULL
  AND is_account_member(account_id)
  AND archived_at IS NULL
);