-- Adds is_legacy and legacy_source_path to scene_rounds.
-- is_legacy = true on rounds imported from Dropbox VS_Visuals history at scene-link time.
-- These rounds are read-only delivered history; they never enter the booking/payment flow.
ALTER TABLE scene_rounds
  ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS legacy_source_path TEXT;
