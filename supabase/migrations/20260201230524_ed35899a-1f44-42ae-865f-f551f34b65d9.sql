-- FINAL DECOMMISSION: Remove legacy scene-images bucket entirely
-- Dropbox is the sole file store for client review media

-- Drop all remaining RLS policies referencing scene-images
DROP POLICY IF EXISTS "Admins can upload scene images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update scene images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete scene images" ON storage.objects;

-- Delete the bucket (already empty, verified via query)
DELETE FROM storage.buckets WHERE id = 'scene-images';