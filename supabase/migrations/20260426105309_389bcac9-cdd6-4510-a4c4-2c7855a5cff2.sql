-- Activity log table (production-critical events)
CREATE TABLE public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_name text,
  actor_role text,
  action text NOT NULL,
  description text NOT NULL,
  entity_type text,
  entity_id uuid,
  project_id uuid,
  project_name text,
  scene_id uuid,
  scene_name text,
  round_id uuid,
  round_number integer,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_activity_log_created_at ON public.activity_log (created_at DESC);
CREATE INDEX idx_activity_log_project ON public.activity_log (project_id);
CREATE INDEX idx_activity_log_scene ON public.activity_log (scene_id);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all activity"
  ON public.activity_log FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "Authenticated can insert activity"
  ON public.activity_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Dismissals table (per-admin "hide from my preview")
CREATE TABLE public.activity_log_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  activity_id uuid NOT NULL REFERENCES public.activity_log(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, activity_id)
);

CREATE INDEX idx_activity_log_dismissals_user ON public.activity_log_dismissals (user_id);

ALTER TABLE public.activity_log_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view own dismissals"
  ON public.activity_log_dismissals FOR SELECT
  TO authenticated
  USING (is_admin() AND auth.uid() = user_id);

CREATE POLICY "Admins insert own dismissals"
  ON public.activity_log_dismissals FOR INSERT
  TO authenticated
  WITH CHECK (is_admin() AND auth.uid() = user_id);

CREATE POLICY "Admins delete own dismissals"
  ON public.activity_log_dismissals FOR DELETE
  TO authenticated
  USING (is_admin() AND auth.uid() = user_id);
