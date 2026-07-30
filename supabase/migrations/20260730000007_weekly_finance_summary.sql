-- 20260730000007_weekly_finance_summary.sql
--
-- ADDITIVE. Replaces the per-overhead daily reminder blast (send-overhead-
-- reminder, ~100 emails/morning) with ONE weekly consolidated financial
-- position + outlook email, Mondays 08:00 UK.
--
-- Two parts, both additive:
--   1. app_settings.finance_summary_config — recipient + on/off toggle.
--   2. pg_cron 'finance-summary-weekly' — Mondays 07:00 UTC (= 08:00 UK during
--      BST; drifts to 07:00 UK in winter, same known limitation as every other
--      cron on this DB — pg_cron 1.6 has no per-job timezone).
--
-- The old 'overhead-reminders-daily' cron (jobid 12) was unscheduled and its
-- config disabled out-of-band on 30 Jul 2026 when the flood was reported; this
-- migration records the replacement. Sends the vault cron secret as
-- X-Cron-Secret so the gated function (requireInternalOrAdmin) accepts it.

INSERT INTO public.app_settings (key, value)
VALUES (
  'finance_summary_config',
  jsonb_build_object(
    'enabled', true,
    'recipient', 'fred@silvershadowstudio.com'
  )
)
ON CONFLICT (key) DO NOTHING;

SELECT cron.schedule(
  'finance-summary-weekly',
  '0 7 * * 1',
  $$
  SELECT net.http_post(
    url     := 'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/weekly-finance-summary',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body    := jsonb_build_object('trigger','cron'),
    timeout_milliseconds := 60000
  );
  $$
);
