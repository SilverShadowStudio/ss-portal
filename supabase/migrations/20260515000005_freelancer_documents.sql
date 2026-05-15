-- Introduces freelancer_documents to store both NDA and FSA PDFs per freelancer.
-- freelancer_agreements is retained to preserve any existing rows.

CREATE TABLE IF NOT EXISTS freelancer_documents (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID        REFERENCES accounts(id),
  profile_id     UUID        REFERENCES freelancer_profiles(id),
  document_type  TEXT        NOT NULL CHECK (document_type IN ('nda', 'service_agreement')),
  signed_at      TIMESTAMPTZ,
  signed_by_name TEXT,
  pdf_url        TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE freelancer_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fd_own_select" ON freelancer_documents
  FOR SELECT USING (
    profile_id IN (SELECT id FROM freelancer_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "fd_admin_read" ON freelancer_documents
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('freelancer-documents', 'freelancer-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "fd_storage_own" ON storage.objects
  FOR ALL USING (
    bucket_id = 'freelancer-documents'
    AND auth.uid()::text = split_part(name, '/', 1)
  );

CREATE POLICY "fd_storage_admin" ON storage.objects
  FOR ALL USING (
    bucket_id = 'freelancer-documents'
    AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );
