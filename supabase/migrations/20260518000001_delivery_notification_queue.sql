-- 20260518000001_delivery_notification_queue.sql
--
-- Queue table for delivery notification emails. dropbox-webhook inserts a row
-- after a successful deliverRound() with the computed send_at time (now if
-- in UK working hours 09:00-20:00, else 09:00 next UK morning). A pg_cron job
-- runs every 5 minutes and calls dispatch-pending-deliveries, which picks up
-- due rows, sends via Resend, and stamps sent_at.

CREATE TABLE IF NOT EXISTS public.pending_delivery_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_round_id  uuid NOT NULL REFERENCES public.scene_rounds(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  send_at         timestamptz NOT NULL,
  sent_at         timestamptz,
  payload         jsonb NOT NULL,
  attempts        smallint NOT NULL DEFAULT 0,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup of due-but-unsent rows.
CREATE INDEX IF NOT EXISTS pending_delivery_notifications_due_idx
  ON public.pending_delivery_notifications (send_at)
  WHERE sent_at IS NULL;

-- Defensive: prevent duplicate pending rows for the same round.
CREATE UNIQUE INDEX IF NOT EXISTS pending_delivery_notifications_unique_unsent
  ON public.pending_delivery_notifications (scene_round_id)
  WHERE sent_at IS NULL;

-- RLS — admin-only.
ALTER TABLE public.pending_delivery_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read pending_delivery_notifications"
  ON public.pending_delivery_notifications
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can manage pending_delivery_notifications"
  ON public.pending_delivery_notifications
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Cron: every 5 min, ping the dispatcher edge function.
-- Auth uses the public anon key (same pattern as airtable-auto-sync triggers).
SELECT cron.schedule(
  'dispatch-pending-deliveries',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/dispatch-pending-deliveries',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZGhzb2l3bnF4Y2ltem16aWNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMjYsImV4cCI6MjA5NDA4NzEyNn0.K1kAeQyhdu_DTjMq--0M7sQU8Cr8CtqkUqAmchPOr1I'
    ),
    body    := '{}'::jsonb
  );
  $cron$
);
