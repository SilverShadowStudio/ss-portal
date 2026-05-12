-- 20260512000001_airtable_auto_sync_triggers.sql
--
-- Creates database triggers that automatically push scene_rounds changes to Airtable
-- and fire email notifications via the airtable-auto-sync edge function.
--
-- Three triggers:
--   airtable_round_created          — fires on INSERT (new round)
--   airtable_status_changed         — fires on UPDATE when status changes
--   airtable_instructions_submitted — fires on UPDATE when instructions are set/changed
--
-- The triggers use supabase_functions.http_request (Supabase's built-in DB webhook
-- mechanism). The anon key in the Authorization header is the same public key already
-- present in the frontend client bundle.
--
-- The x-trigger-name custom header tells the edge function which event fired, since all
-- three triggers call the same function URL.
--
-- After applying this migration, deploy the edge function:
--   SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy airtable-auto-sync \
--     --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt
--
-- Then add secrets via the Supabase dashboard (Settings > Edge Functions > Secrets):
--   RESEND_API_KEY — get from resend.com after verifying silvershadowstudio.com domain

-- ── Trigger 1: New round created ──────────────────────────────────────────────
-- Fires on every INSERT into scene_rounds. Pushes the scene to Airtable (creates
-- or updates the Task record) and sends a notification email.

DROP TRIGGER IF EXISTS airtable_round_created ON public.scene_rounds;

CREATE TRIGGER airtable_round_created
  AFTER INSERT ON public.scene_rounds
  FOR EACH ROW
  EXECUTE FUNCTION supabase_functions.http_request(
    'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/airtable-auto-sync',
    'POST',
    '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZGhzb2l3bnF4Y2ltem16aWNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMjYsImV4cCI6MjA5NDA4NzEyNn0.K1kAeQyhdu_DTjMq--0M7sQU8Cr8CtqkUqAmchPOr1I","x-trigger-name":"round_created"}',
    '{}',
    '5000'
  );

-- ── Trigger 2: Round status changed ───────────────────────────────────────────
-- Fires on UPDATE only when the status column actually changes.
-- WHEN clause prevents firing on unrelated column updates.

DROP TRIGGER IF EXISTS airtable_status_changed ON public.scene_rounds;

CREATE TRIGGER airtable_status_changed
  AFTER UPDATE ON public.scene_rounds
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION supabase_functions.http_request(
    'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/airtable-auto-sync',
    'POST',
    '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZGhzb2l3bnF4Y2ltem16aWNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMjYsImV4cCI6MjA5NDA4NzEyNn0.K1kAeQyhdu_DTjMq--0M7sQU8Cr8CtqkUqAmchPOr1I","x-trigger-name":"status_changed"}',
    '{}',
    '5000'
  );

-- ── Trigger 3: Instructions submitted ─────────────────────────────────────────
-- Fires on UPDATE when instructions is set for the first time or changed.
-- Does NOT fire when instructions is cleared to NULL.

DROP TRIGGER IF EXISTS airtable_instructions_submitted ON public.scene_rounds;

CREATE TRIGGER airtable_instructions_submitted
  AFTER UPDATE ON public.scene_rounds
  FOR EACH ROW
  WHEN (NEW.instructions IS NOT NULL AND OLD.instructions IS DISTINCT FROM NEW.instructions)
  EXECUTE FUNCTION supabase_functions.http_request(
    'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/airtable-auto-sync',
    'POST',
    '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZGhzb2l3bnF4Y2ltem16aWNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMjYsImV4cCI6MjA5NDA4NzEyNn0.K1kAeQyhdu_DTjMq--0M7sQU8Cr8CtqkUqAmchPOr1I","x-trigger-name":"instructions_submitted"}',
    '{}',
    '5000'
  );
