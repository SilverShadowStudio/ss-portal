-- 20260512000001_airtable_auto_sync_triggers.sql
--
-- Creates three trigger functions + triggers on scene_rounds that automatically
-- push changes to Airtable and fire email notifications.
--
-- Uses net.http_post() from the pg_net extension directly (pg_net is already
-- installed in this project). Each trigger gets a dedicated PL/pgSQL wrapper
-- function that builds the payload and fires an async HTTP POST to the
-- airtable-auto-sync edge function. The call is non-blocking — pg_net sends
-- the request in the background after the transaction commits.
--
-- x-trigger-name header tells the edge function which of the three events fired.
-- The anon key in Authorization is the same public key in the browser client bundle.
--
-- After applying this migration, deploy the edge function once:
--   SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy airtable-auto-sync \
--     --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt
--
-- Then add RESEND_API_KEY in Supabase dashboard → Settings → Edge Functions → Secrets.

-- ── Shared header constant ────────────────────────────────────────────────────
-- Extracted into a helper to keep the three trigger functions DRY.

CREATE OR REPLACE FUNCTION public.internal_airtable_sync_headers(trigger_name text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'Content-Type',   'application/json',
    'Authorization',  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZGhzb2l3bnF4Y2ltem16aWNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMjYsImV4cCI6MjA5NDA4NzEyNn0.K1kAeQyhdu_DTjMq--0M7sQU8Cr8CtqkUqAmchPOr1I',
    'x-trigger-name', trigger_name
  )
$$;

-- ── Trigger function 1: round_created (INSERT) ────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_airtable_round_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url     => 'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/airtable-auto-sync',
    headers => public.internal_airtable_sync_headers('round_created'),
    body    => jsonb_build_object(
      'type',       TG_OP,
      'table',      TG_TABLE_NAME,
      'schema',     TG_TABLE_SCHEMA,
      'record',     to_jsonb(NEW),
      'old_record', NULL::jsonb
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS airtable_round_created ON public.scene_rounds;
CREATE TRIGGER airtable_round_created
  AFTER INSERT ON public.scene_rounds
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_airtable_round_created();

-- ── Trigger function 2: status_changed (UPDATE, status column only) ───────────

CREATE OR REPLACE FUNCTION public.trg_airtable_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url     => 'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/airtable-auto-sync',
    headers => public.internal_airtable_sync_headers('status_changed'),
    body    => jsonb_build_object(
      'type',       TG_OP,
      'table',      TG_TABLE_NAME,
      'schema',     TG_TABLE_SCHEMA,
      'record',     to_jsonb(NEW),
      'old_record', to_jsonb(OLD)
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS airtable_status_changed ON public.scene_rounds;
CREATE TRIGGER airtable_status_changed
  AFTER UPDATE ON public.scene_rounds
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trg_airtable_status_changed();

-- ── Trigger function 3: instructions_submitted (UPDATE, instructions column) ──

CREATE OR REPLACE FUNCTION public.trg_airtable_instructions_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url     => 'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/airtable-auto-sync',
    headers => public.internal_airtable_sync_headers('instructions_submitted'),
    body    => jsonb_build_object(
      'type',       TG_OP,
      'table',      TG_TABLE_NAME,
      'schema',     TG_TABLE_SCHEMA,
      'record',     to_jsonb(NEW),
      'old_record', to_jsonb(OLD)
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS airtable_instructions_submitted ON public.scene_rounds;
CREATE TRIGGER airtable_instructions_submitted
  AFTER UPDATE ON public.scene_rounds
  FOR EACH ROW
  WHEN (NEW.instructions IS NOT NULL AND OLD.instructions IS DISTINCT FROM NEW.instructions)
  EXECUTE FUNCTION public.trg_airtable_instructions_submitted();
