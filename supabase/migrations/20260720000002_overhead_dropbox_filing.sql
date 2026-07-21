-- Overhead Drop Zone — Pass 3: Dropbox filing (trigger + lock + log)
--
-- Adds:
--   1. Two lock columns on public.overheads for the in-flight guard:
--      dropbox_upload_in_progress + dropbox_upload_started_at.
--   2. public.overhead_dropbox_log — append-only observability table (mirror
--      of payables_sync_log's shape). One row per attempt (success / fail /
--      skipped_locked). Admin-select-only RLS; service-role writes bypass.
--   3. Trigger function + AFTER INSERT/UPDATE trigger on overheads. Fires
--      net.http_post to `dropbox-save-overhead-file` whenever the row is in
--      the "pending Dropbox filing" state (staging_storage_path set,
--      dropbox_path null). The edge function's atomic lock acquisition
--      handles duplicate fires from any-field UPDATEs.
--
-- Auth pattern matches dropbox-save-round-files (deployed --no-verify-jwt):
-- trigger passes anon-JWT + `x-trigger-name: overhead_filing_pending`.
-- Frontend "Retry Dropbox upload" button will pass admin JWT via
-- supabase.functions.invoke(); function validates both paths.
--
-- Edge function to deploy after applying:
--   npx supabase functions deploy dropbox-save-overhead-file \
--     --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

-- 1. Lock columns ------------------------------------------------------------
ALTER TABLE public.overheads
  ADD COLUMN IF NOT EXISTS dropbox_upload_in_progress BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dropbox_upload_started_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.overheads.dropbox_upload_in_progress IS
  'Anti-double-upload guard. TRUE while an edge function invocation is '
  'actively uploading to Dropbox. Paired with dropbox_upload_started_at so '
  'stale locks older than 5 minutes are treated as expired (never blocks '
  'retries indefinitely).';

COMMENT ON COLUMN public.overheads.dropbox_upload_started_at IS
  'Set when the lock is acquired; used to expire stale locks.';

-- 2. Observability log -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.overhead_dropbox_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  overhead_id  UUID NOT NULL REFERENCES public.overheads(id) ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status       TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped_locked', 'skipped_not_pending')),
  dropbox_path TEXT,
  error_text   TEXT,
  duration_ms  INTEGER,
  trigger_source TEXT  -- 'trigger' | 'manual_retry' | 'unknown'
);

CREATE INDEX IF NOT EXISTS overhead_dropbox_log_overhead_id_idx
  ON public.overhead_dropbox_log (overhead_id, attempted_at DESC);

ALTER TABLE public.overhead_dropbox_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS overhead_dropbox_log_admin_select ON public.overhead_dropbox_log;

CREATE POLICY overhead_dropbox_log_admin_select
  ON public.overhead_dropbox_log
  FOR SELECT USING (public.is_admin());
-- No INSERT/UPDATE/DELETE policies — writes only via service_role from the
-- edge function; other roles deny by default.

-- 3. Trigger function --------------------------------------------------------
-- Reuses public.internal_dropbox_trigger_headers() from the round-files
-- trigger migration (20260512000002). If that helper is renamed, this
-- trigger will need updating.

CREATE OR REPLACE FUNCTION public.trg_dropbox_overhead_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url     => 'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/dropbox-save-overhead-file',
    headers => public.internal_dropbox_trigger_headers('overhead_filing_pending'),
    body    => jsonb_build_object(
      'type',       TG_OP,
      'table',      TG_TABLE_NAME,
      'schema',     TG_TABLE_SCHEMA,
      'record',     to_jsonb(NEW),
      'old_record', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL::jsonb END,
      'trigger_source', 'trigger'
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS overheads_dropbox_pending ON public.overheads;
CREATE TRIGGER overheads_dropbox_pending
  AFTER INSERT OR UPDATE ON public.overheads
  FOR EACH ROW
  -- Only fire when the post-state is "pending Dropbox filing":
  --   file is staged AND not yet mirrored to Dropbox.
  -- The edge function's own lock acquisition handles duplicate fires from
  -- unrelated UPDATEs (e.g. Fred editing notes while filing is in flight).
  WHEN (
    NEW.staging_storage_path IS NOT NULL
    AND NEW.dropbox_path IS NULL
  )
  EXECUTE FUNCTION public.trg_dropbox_overhead_pending();
