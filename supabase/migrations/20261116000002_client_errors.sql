-- When a page crashes, the portal used to go black with no trace. The page
-- error boundary now shows a message and records the error here, so a crash
-- someone saw can be read back and fixed (Fred, 16 Nov 2026: the team
-- Calendar going black). Additive: one table, two policies.
CREATE TABLE IF NOT EXISTS public.client_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid DEFAULT auth.uid(),
  path text,
  message text,
  stack text,
  component_stack text,
  user_agent text
);
ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_errors: signed-in users record their own"
  ON public.client_errors FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY "client_errors: admins read"
  ON public.client_errors FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE INDEX IF NOT EXISTS client_errors_created_at_idx ON public.client_errors (created_at DESC);
