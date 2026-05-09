CREATE TABLE public.client_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  actor_name text,
  actor_role text,
  kind text NOT NULL CHECK (kind IN ('session_start','session_end','page_view')),
  session_id uuid,
  path text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_ms integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_activity_user_created
  ON public.client_activity (user_id, created_at DESC);
CREATE INDEX idx_client_activity_session
  ON public.client_activity (session_id);
CREATE INDEX idx_client_activity_kind_created
  ON public.client_activity (kind, created_at DESC);

ALTER TABLE public.client_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own client activity"
  ON public.client_activity
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own client activity"
  ON public.client_activity
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all client activity"
  ON public.client_activity
  FOR SELECT
  TO authenticated
  USING (is_admin());