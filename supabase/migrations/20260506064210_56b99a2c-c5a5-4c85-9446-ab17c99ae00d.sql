
-- Subscriptions: one per account
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE,
  active_lanes INTEGER NOT NULL DEFAULT 1 CHECK (active_lanes BETWEEN 0 AND 10),
  monthly_cost_pence BIGINT NOT NULL DEFAULT 395000,
  status TEXT NOT NULL DEFAULT 'active', -- active|paused|cancelled
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paused_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage subscriptions" ON public.subscriptions
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Members view account subscription" ON public.subscriptions
  FOR SELECT TO authenticated USING (is_account_member(account_id));

CREATE POLICY "Owner updates subscription" ON public.subscriptions
  FOR UPDATE TO authenticated USING (is_account_owner(account_id))
  WITH CHECK (is_account_owner(account_id));

CREATE TRIGGER trg_subscriptions_updated
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lane tasks: items queued inside a lane
CREATE TABLE public.lane_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  lane_index INTEGER NOT NULL DEFAULT 1 CHECK (lane_index BETWEEN 1 AND 10),
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'queued', -- queued|in_progress|completed|cancelled
  project_id UUID,
  created_by UUID NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lane_tasks_account ON public.lane_tasks(account_id, lane_index, position);

ALTER TABLE public.lane_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage lane tasks" ON public.lane_tasks
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Members view account lane tasks" ON public.lane_tasks
  FOR SELECT TO authenticated USING (is_account_member(account_id));

CREATE POLICY "Members create account lane tasks" ON public.lane_tasks
  FOR INSERT TO authenticated
  WITH CHECK (is_account_member(account_id) AND created_by = auth.uid());

CREATE POLICY "Members update account lane tasks" ON public.lane_tasks
  FOR UPDATE TO authenticated USING (is_account_member(account_id))
  WITH CHECK (is_account_member(account_id));

CREATE TRIGGER trg_lane_tasks_updated
BEFORE UPDATE ON public.lane_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
