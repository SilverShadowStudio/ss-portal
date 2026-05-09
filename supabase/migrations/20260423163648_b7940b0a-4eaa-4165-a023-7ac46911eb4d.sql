
-- Create storage bucket for round uploads
INSERT INTO storage.buckets (id, name, public) VALUES ('round-uploads', 'round-uploads', true);

-- Storage policies
CREATE POLICY "Users can upload round files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'round-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view their own round files"
ON storage.objects FOR SELECT
USING (bucket_id = 'round-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own round files"
ON storage.objects FOR DELETE
USING (bucket_id = 'round-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Admins can view all round files"
ON storage.objects FOR SELECT
USING (bucket_id = 'round-uploads' AND public.is_admin());

CREATE POLICY "Admins can delete round files"
ON storage.objects FOR DELETE
USING (bucket_id = 'round-uploads' AND public.is_admin());

-- Create table to track uploads metadata
CREATE TABLE public.round_uploads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scene_id UUID NOT NULL,
  user_id UUID NOT NULL,
  category TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size BIGINT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.round_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own round uploads"
ON public.round_uploads FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own round uploads"
ON public.round_uploads FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own round uploads"
ON public.round_uploads FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all round uploads"
ON public.round_uploads FOR SELECT
USING (public.is_admin());

CREATE POLICY "Admins can delete all round uploads"
ON public.round_uploads FOR DELETE
USING (public.is_admin());
