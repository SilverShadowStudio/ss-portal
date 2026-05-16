-- Migration: 20260516000002_studio_showcase_images.sql
-- Source-of-truth list for the hero images shown on the client dashboard's
-- idle state. Admins curate the list; clients see one image at random on
-- each visit. The portal falls back to a hardcoded list if this table is
-- empty or unreachable.
--
-- NOT YET APPLIED — author-only. Apply via the Management API when ready.

CREATE TABLE IF NOT EXISTS studio_showcase_images (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url        TEXT        NOT NULL,
  project_name     TEXT,
  location         TEXT,
  year_completed   INTEGER,
  display_order    INTEGER     NOT NULL DEFAULT 0,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_studio_showcase_images_active_order
  ON studio_showcase_images (is_active, display_order);

ALTER TABLE studio_showcase_images ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read the showcase list (it's brand content,
-- not client-specific data).
CREATE POLICY "authenticated_select_studio_showcase_images"
  ON studio_showcase_images FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Only admins write.
CREATE POLICY "admins_insert_studio_showcase_images"
  ON studio_showcase_images FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admins_update_studio_showcase_images"
  ON studio_showcase_images FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admins_delete_studio_showcase_images"
  ON studio_showcase_images FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );
