-- 20260512000002_dropbox_folder_triggers.sql
--
-- Adds dropbox_folder columns to projects and scenes, then creates three
-- pg_net triggers that automatically call Dropbox automation edge functions
-- when projects, scenes, and scene_rounds are created.
--
-- Trigger functions use net.http_post() (pg_net, already enabled) — same
-- pattern as 20260512000001_airtable_auto_sync_triggers.sql. All calls are
-- async and non-blocking.
--
-- Edge functions to deploy after applying this migration:
--   npx supabase functions deploy dropbox-create-project-folder --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt
--   npx supabase functions deploy dropbox-create-scene-folder   --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt
--   npx supabase functions deploy dropbox-save-round-files      --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

-- ── Schema additions ──────────────────────────────────────────────────────────

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS dropbox_folder TEXT;  -- full Dropbox path, e.g. /00_Production/PRD01_Client-Projects/CP113_Charles-Street

ALTER TABLE public.scenes
  ADD COLUMN IF NOT EXISTS dropbox_folder TEXT;  -- full Dropbox path, e.g. /00_Production/PRD01_Client-Projects/CP113_Charles-Street/SC03_Facade

-- ── Shared header helper ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.internal_dropbox_trigger_headers(trigger_name text)
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

-- ── Trigger 1: Project created → create Dropbox project folder ────────────────

CREATE OR REPLACE FUNCTION public.trg_dropbox_project_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url     => 'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/dropbox-create-project-folder',
    headers => public.internal_dropbox_trigger_headers('project_created'),
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

DROP TRIGGER IF EXISTS dropbox_project_created ON public.projects;
CREATE TRIGGER dropbox_project_created
  AFTER INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_dropbox_project_created();

-- ── Trigger 2: Scene created → create Dropbox scene folder + subfolders ───────

CREATE OR REPLACE FUNCTION public.trg_dropbox_scene_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url     => 'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/dropbox-create-scene-folder',
    headers => public.internal_dropbox_trigger_headers('scene_created'),
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

DROP TRIGGER IF EXISTS dropbox_scene_created ON public.scenes;
CREATE TRIGGER dropbox_scene_created
  AFTER INSERT ON public.scenes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_dropbox_scene_created();

-- ── Trigger 3: Round created → copy brief files + PDF + annotations ───────────

CREATE OR REPLACE FUNCTION public.trg_dropbox_round_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url     => 'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/dropbox-save-round-files',
    headers => public.internal_dropbox_trigger_headers('round_created'),
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

DROP TRIGGER IF EXISTS dropbox_round_created ON public.scene_rounds;
CREATE TRIGGER dropbox_round_created
  AFTER INSERT ON public.scene_rounds
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_dropbox_round_created();
