-- Add image_url column to scene_rounds for storing render images
ALTER TABLE public.scene_rounds ADD COLUMN image_url text;

-- Create storage bucket for scene images
INSERT INTO storage.buckets (id, name, public) 
VALUES ('scene-images', 'scene-images', true);

-- Storage policies for scene-images bucket
-- Anyone can view images (they're public for client viewing)
CREATE POLICY "Scene images are publicly accessible"
ON storage.objects
FOR SELECT
USING (bucket_id = 'scene-images');

-- Only admins can upload images
CREATE POLICY "Admins can upload scene images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'scene-images' AND public.is_admin());

-- Only admins can update images
CREATE POLICY "Admins can update scene images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'scene-images' AND public.is_admin());

-- Only admins can delete images
CREATE POLICY "Admins can delete scene images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'scene-images' AND public.is_admin());