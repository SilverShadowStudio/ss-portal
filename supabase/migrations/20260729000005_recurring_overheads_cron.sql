-- Generate recurring overheads monthly. On the 1st at 02:00 UTC, create each
-- active template's new-month unpaid entry (and backfill any it missed).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recurring-overheads-monthly') THEN
    PERFORM cron.unschedule('recurring-overheads-monthly');
  END IF;
END $$;

SELECT cron.schedule(
  'recurring-overheads-monthly',
  '0 2 1 * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/recurring-overheads-generate',
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
