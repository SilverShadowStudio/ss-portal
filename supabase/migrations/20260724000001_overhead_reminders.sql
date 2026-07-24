-- 20260724000001_overhead_reminders.sql
--
-- Pass 4 of the Overhead Drop Zone: due-date reminders.
--
-- Adds:
--   1. overheads.last_reminder_sent_at         — timestamp of the most recent
--      reminder email sent for a row. Populated by send-overhead-reminder
--      only. Drives both same-day idempotence (due-today / due-in-7-days)
--      and the 7-day interval guard on the overdue nudge.
--   2. Partial index for the daily cron scan   — unpaid rows that have a
--      due_date. Covers due-today, 7-days-out, and overdue cases.
--   3. app_settings.overhead_reminder_config   — seed row with the default
--      recipient (accounting@silvershadowstudio.com) plus an empty
--      additional_recipients array. Edited by SQL until an admin UI ships.
--   4. pg_cron daily job overhead-reminders-daily at 07:00 UTC, calling
--      send-overhead-reminder via net.http_post. Authenticated with an
--      X-Cron-Secret header read from Vault, not a hardcoded value — see
--      the note above the cron.schedule call below.
--
-- Timezone note.
--   pg_cron 1.6.4 on this instance exposes only cron.schedule(name,cron,cmd)
--   and cron.schedule(cron,cmd) — no per-job timezone argument. The
--   database-level cron.timezone GUC is 'GMT'; leaving it there rather than
--   mutating a DB-wide setting that affects every scheduled job. As a
--   consequence '0 7 * * *' UTC drifts by one hour twice a year vs UK
--   local time:
--     • BST (late Mar – late Oct): 07:00 UTC = 08:00 UK
--     • GMT (late Oct – late Mar): 07:00 UTC = 07:00 UK
--   Acceptable for a pre-workday accounting reminder.

-- 1. Column ------------------------------------------------------------
ALTER TABLE public.overheads
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.overheads.last_reminder_sent_at IS
  'Timestamp of the most recent due-date reminder email sent for this row. Populated by send-overhead-reminder only. Guards same-day duplicates on the due-today/7-days-out cases and enforces a 7-day interval on the overdue nudge.';

-- 2. Cron scan index ---------------------------------------------------
CREATE INDEX IF NOT EXISTS overheads_due_reminder_idx
  ON public.overheads (due_date)
  WHERE payment_status = 'unpaid' AND due_date IS NOT NULL;

-- 3. Config seed -------------------------------------------------------
-- Additive: existing row (if any) is left untouched. Recipients editable
-- by admin via SQL until a UI is added in a follow-on slice.
INSERT INTO public.app_settings (key, value)
VALUES (
  'overhead_reminder_config',
  jsonb_build_object(
    'enabled',               true,
    'default_recipient',     'accounting@silvershadowstudio.com',
    'additional_recipients', jsonb_build_array()
  )
)
ON CONFLICT (key) DO NOTHING;

-- 4. Cron schedule -----------------------------------------------------
-- Auth note.
--   send-overhead-reminder sends real email and stamps last_reminder_sent_at,
--   so it must not be reachable with the anon key (which ships in the client
--   bundle and is public by design). It is gated on an X-Cron-Secret header
--   compared constant-time against the CRON_SECRET function env var
--   (see supabase/functions/_shared/cronAuth.ts).
--
--   The secret is NOT hardcoded here. It lives in Supabase Vault under the
--   name 'cron_secret' and the job reads it by reference at run time, so this
--   file stays reproducible and carries nothing sensitive into git.
--
--   Prerequisites, both set out of band (never committed):
--     • Vault secret:  select vault.create_secret('<value>', 'cron_secret');
--     • Function env:  supabase secrets set CRON_SECRET=<same value>
--   The two must match or the job 401s. Rotate both together.

-- Safe re-run guard: unschedule any prior version by name before adding.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'overhead-reminders-daily') THEN
    PERFORM cron.unschedule('overhead-reminders-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'overhead-reminders-daily',
  '0 7 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/send-overhead-reminder',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZGhzb2l3bnF4Y2ltem16aWNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMjYsImV4cCI6MjA5NDA4NzEyNn0.K1kAeQyhdu_DTjMq--0M7sQU8Cr8CtqkUqAmchPOr1I',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);
