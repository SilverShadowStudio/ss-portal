-- Overhead Drop Zone — Pass 2: staging storage for extracted invoices
--
-- Adds:
--   1. Private storage bucket `overhead-invoices` for staging the original
--      PDF/JPG the user dropped, so it survives the review gate. Pass 3 will
--      move confirmed files from staging into Dropbox.
--   2. Admin-only RLS on storage.objects for that bucket (mirrors the
--      admin-only RLS already on public.overheads).
--   3. `staging_storage_path` column on public.overheads. NON-NULL means the
--      file is staged in the bucket, awaiting Dropbox upload; Pass 3 will
--      clear this alongside setting dropbox_path.

-- 1. Bucket ------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('overhead-invoices', 'overhead-invoices', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Storage RLS -------------------------------------------------------------
-- Admin-only across the board. Non-admin sessions get zero access even to
-- their own uploads (unlike the agreements bucket which uses per-user
-- foldername gating); overheads are internal-only, no client surface.

DROP POLICY IF EXISTS overhead_invoices_admin_select ON storage.objects;
DROP POLICY IF EXISTS overhead_invoices_admin_insert ON storage.objects;
DROP POLICY IF EXISTS overhead_invoices_admin_update ON storage.objects;
DROP POLICY IF EXISTS overhead_invoices_admin_delete ON storage.objects;

CREATE POLICY overhead_invoices_admin_select ON storage.objects
  FOR SELECT USING (bucket_id = 'overhead-invoices' AND public.is_admin());
CREATE POLICY overhead_invoices_admin_insert ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'overhead-invoices' AND public.is_admin());
CREATE POLICY overhead_invoices_admin_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'overhead-invoices' AND public.is_admin())
             WITH CHECK (bucket_id = 'overhead-invoices' AND public.is_admin());
CREATE POLICY overhead_invoices_admin_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'overhead-invoices' AND public.is_admin());

-- 3. Column ------------------------------------------------------------------
ALTER TABLE public.overheads
  ADD COLUMN IF NOT EXISTS staging_storage_path TEXT;

COMMENT ON COLUMN public.overheads.staging_storage_path IS
  'Path inside the overhead-invoices bucket where the original invoice file '
  'is staged. NON-NULL means the file is pending upload to Dropbox '
  '(cleared by Pass 3 once dropbox_path is set).';
