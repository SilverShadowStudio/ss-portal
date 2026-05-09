-- Lock down legacy scene-images bucket (unused - all access now via Dropbox Edge Functions)

-- Set bucket to private
UPDATE storage.buckets SET public = false WHERE id = 'scene-images';

-- Remove public SELECT policy (only policy scoped to scene-images)
DROP POLICY IF EXISTS "Scene images are publicly accessible" ON storage.objects;