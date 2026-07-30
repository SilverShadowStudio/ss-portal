-- 20260730000005_trigger_header_secret.sql
--
-- ⚠️ DESTRUCTIVE (replaces two existing SQL functions) — DO NOT APPLY without
-- Fred's explicit sign-off. Written 30 Jul 2026; apply via scripts/sql.sh.
--
-- Closes the trigger-auth hole: DB triggers currently authenticate to edge
-- functions with only the public anon JWT plus a guessable x-trigger-name
-- marker. Anyone can replay those headers and drive service-role writes.
--
-- Fix: both header helpers additionally send x-cron-secret, read from Vault
-- (secret name 'cron_secret' — the same one the pg_cron jobs use). The gated
-- functions (requireInternalOrAdmin in _shared/cronAuth.ts) accept it via
-- constant-time compare against the CRON_SECRET function env var.
--
-- DEPLOY ORDER (zero downtime):
--   1. Apply this migration. The extra header is ignored by the currently
--      deployed (ungated) functions — harmless.
--   2. Ensure CRON_SECRET is set in the function env for: airtable-auto-sync,
--      dropbox-create-project-folder, dropbox-create-scene-folder,
--      dropbox-save-round-files, dropbox-save-invoice-file,
--      dropbox-save-overhead-file (same value as Vault 'cron_secret').
--   3. Deploy the gated functions one at a time, verifying each byte-identical
--      (npx supabase functions download + diff).
--   4. Fire one test event per trigger and confirm 200s in net._http_response.
--
-- Note: the helpers change IMMUTABLE → STABLE (a Vault read is not immutable)
-- and gain SECURITY DEFINER + fixed search_path so the vault read works
-- regardless of the calling role. COALESCE to '' means a missing Vault row
-- degrades to a visible 401 in net._http_response, never a silent bypass.

CREATE OR REPLACE FUNCTION public.internal_dropbox_trigger_headers(trigger_name text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'Content-Type',   'application/json',
    'Authorization',  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZGhzb2l3bnF4Y2ltem16aWNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMjYsImV4cCI6MjA5NDA4NzEyNn0.K1kAeQyhdu_DTjMq--0M7sQU8Cr8CtqkUqAmchPOr1I',
    'x-trigger-name', trigger_name,
    'x-cron-secret',  COALESCE(
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'),
      ''
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.internal_airtable_sync_headers(trigger_name text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'Content-Type',   'application/json',
    'Authorization',  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZGhzb2l3bnF4Y2ltem16aWNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMjYsImV4cCI6MjA5NDA4NzEyNn0.K1kAeQyhdu_DTjMq--0M7sQU8Cr8CtqkUqAmchPOr1I',
    'x-trigger-name', trigger_name,
    'x-cron-secret',  COALESCE(
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'),
      ''
    )
  )
$$;

-- Lock down direct calls: the helpers expose a decrypted secret, so only the
-- roles that legitimately execute trigger functions may call them.
REVOKE EXECUTE ON FUNCTION public.internal_dropbox_trigger_headers(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.internal_airtable_sync_headers(text) FROM PUBLIC, anon, authenticated;
