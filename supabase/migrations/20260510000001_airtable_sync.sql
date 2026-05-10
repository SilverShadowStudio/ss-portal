-- Support for Airtable bidirectional sync

-- Add airtable_record_id to scenes so we can match portal scenes to Airtable records
ALTER TABLE public.scenes
  ADD COLUMN IF NOT EXISTS airtable_record_id TEXT;

CREATE INDEX IF NOT EXISTS idx_scenes_airtable_record_id
  ON public.scenes(airtable_record_id)
  WHERE airtable_record_id IS NOT NULL;

-- App settings table for storing configuration like Airtable field mappings
CREATE TABLE IF NOT EXISTS public.app_settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can read/write app settings
CREATE POLICY "admins_manage_app_settings"
  ON public.app_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
