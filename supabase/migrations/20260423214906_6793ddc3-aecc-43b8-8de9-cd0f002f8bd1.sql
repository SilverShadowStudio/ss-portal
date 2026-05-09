-- Create the agreements storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('agreements', 'agreements', false)
ON CONFLICT (id) DO NOTHING;

-- Create the agreements table to track signed contracts
CREATE TABLE IF NOT EXISTS public.agreements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  company_name TEXT NOT NULL,
  signatory_name TEXT,
  signatory_position TEXT,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  signed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.agreements ENABLE ROW LEVEL SECURITY;

-- Users can view their own agreements
CREATE POLICY "Users can view their own agreements"
ON public.agreements
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own agreements
CREATE POLICY "Users can insert their own agreements"
ON public.agreements
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Admins can view all agreements
CREATE POLICY "Admins can view all agreements"
ON public.agreements
FOR SELECT
USING (is_admin());

-- Storage policies for the agreements bucket
-- Files are stored under <user_id>/<filename>.pdf
CREATE POLICY "Users can view their own agreement files"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'agreements'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can upload their own agreement files"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'agreements'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Admins can view all agreement files"
ON storage.objects
FOR SELECT
USING (bucket_id = 'agreements' AND is_admin());