-- 20260731000003_revolut_sync_cron.sql
-- ADDITIVE. Daily pull of the Revolut feed into bank_transactions.
-- 06:30 UTC; sends the vault cron secret as X-Cron-Secret (revolut-sync is
-- gated with requireInternalOrAdmin).
SELECT cron.schedule(
  'revolut-sync-daily',
  '30 6 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/revolut-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body    := jsonb_build_object('trigger','cron'),
    timeout_milliseconds := 120000
  );
  $$
);
