DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payroll-roll-forward-monthly') THEN
    PERFORM cron.unschedule('payroll-roll-forward-monthly');
  END IF;
END $$;
SELECT cron.schedule('payroll-roll-forward-monthly', '0 3 1 * *', $cron$
  SELECT net.http_post(
    url     := 'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/payroll-roll-forward',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZGhzb2l3bnF4Y2ltem16aWNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMjYsImV4cCI6MjA5NDA4NzEyNn0.K1kAeQyhdu_DTjMq--0M7sQU8Cr8CtqkUqAmchPOr1I',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$cron$);
