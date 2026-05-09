-- Create storage bucket for admin uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('scene-assets', 'scene-assets', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for scene-assets bucket
-- Admins can upload files
CREATE POLICY "Admins can upload scene assets"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'scene-assets' 
  AND public.is_admin()
);

-- Admins can update their uploads
CREATE POLICY "Admins can update scene assets"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'scene-assets' 
  AND public.is_admin()
);

-- Admins can delete their uploads
CREATE POLICY "Admins can delete scene assets"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'scene-assets' 
  AND public.is_admin()
);

-- Everyone can view scene assets (public bucket)
CREATE POLICY "Anyone can view scene assets"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'scene-assets');

-- Add source column to round_assets to distinguish upload method
ALTER TABLE public.round_assets
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'dropbox';

-- Add storage_path column for direct uploads
ALTER TABLE public.round_assets
ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- Make dropbox-specific columns nullable for direct uploads
ALTER TABLE public.round_assets
ALTER COLUMN dropbox_file_id DROP NOT NULL;

ALTER TABLE public.round_assets
ALTER COLUMN dropbox_path DROP NOT NULL;

-- Add constraint to ensure proper source data
ALTER TABLE public.round_assets
ADD CONSTRAINT valid_asset_source CHECK (
  (source = 'dropbox' AND dropbox_file_id IS NOT NULL AND dropbox_path IS NOT NULL)
  OR (source = 'upload' AND storage_path IS NOT NULL)
);