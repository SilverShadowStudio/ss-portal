-- ADDITIVE: let account members read round-uploads objects for scenes in their account.
-- Mirrors the table-level policy "Members can view account round uploads"
-- (20260424104042) which scoped public.round_uploads SELECT to is_account_member,
-- but which was never applied to storage.objects -- leaving client_invitees unable
-- to createSignedUrl for files a manager uploaded (image thumbnails fell back to a
-- generic file icon). This closes that drift.
--
-- Existing policies are LEFT UNTOUCHED (permissive SELECT policies OR-combine):
--   "Users can view their own round files"  (uploader: auth.uid() = foldername[1])
--   "Admins can view all round files"        (public.is_admin())
-- This adds a third grant; it never narrows the existing two.
--
-- Path layout (NewRoundModal.tsx:737): {uploader_uid}/{scene_id}/{category}/{file}
--   foldername[1] = uploader uid, foldername[2] = scene_id   (verified against live data).
-- We compare s.id::text to the path segment (text equality) rather than casting the
-- untrusted segment to uuid, so a malformed/legacy path can never raise a cast error
-- during RLS evaluation -- it simply matches no scene.

CREATE POLICY "Members can view account round files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'round-uploads'
    AND EXISTS (
      SELECT 1
      FROM public.scenes s
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.id::text = (storage.foldername(storage.objects.name))[2]
        AND public.is_account_member(p.account_id)
    )
  );
