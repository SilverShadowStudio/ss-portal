-- Migration: 20260516000001_signatures_audit_log.sql
-- Universal immutable signing audit log used by all document types.
-- Adds forensic columns to quotation_documents and freelancer_documents.
-- Adds storage RLS policies for studio-assets and signatures buckets.

-- ── 1. Universal signatures audit log ────────────────────────────────────────
-- Append-only: no UPDATE/DELETE policies. Edge functions write via service role.

CREATE TABLE IF NOT EXISTS signatures_audit_log (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type        TEXT        NOT NULL
    CHECK (document_type IN ('client_agreement', 'quotation', 'nda', 'service_agreement')),
  document_id          UUID,
  account_id           UUID,
  user_id              UUID        NOT NULL,
  signatory_name       TEXT        NOT NULL,
  signatory_position   TEXT,
  signed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address           TEXT,
  user_agent           TEXT,
  acceptance_text      TEXT,
  version_code         TEXT,
  pdf_sha256           TEXT,
  signature_image_path TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE signatures_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_select_signatures_audit_log"
  ON signatures_audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ── 2. Forensic columns on quotation_documents ────────────────────────────────

ALTER TABLE quotation_documents
  ADD COLUMN IF NOT EXISTS ip_address           TEXT,
  ADD COLUMN IF NOT EXISTS user_agent           TEXT,
  ADD COLUMN IF NOT EXISTS pdf_sha256           TEXT,
  ADD COLUMN IF NOT EXISTS signature_image_path TEXT,
  ADD COLUMN IF NOT EXISTS signed_pdf_path      TEXT;

-- ── 3. Forensic columns on freelancer_documents ───────────────────────────────

ALTER TABLE freelancer_documents
  ADD COLUMN IF NOT EXISTS ip_address           TEXT,
  ADD COLUMN IF NOT EXISTS user_agent           TEXT,
  ADD COLUMN IF NOT EXISTS pdf_sha256           TEXT,
  ADD COLUMN IF NOT EXISTS signature_image_path TEXT;

-- ── 4. Storage RLS: studio-assets (admin uploads Fred's signature PNG) ────────

CREATE POLICY "admins_insert_studio_assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'studio-assets'
    AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admins_update_studio_assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'studio-assets'
    AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admins_select_studio_assets"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'studio-assets'
    AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- ── 5. Storage RLS: signatures bucket (admin read; edge functions write) ──────

CREATE POLICY "admins_select_signatures_bucket"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'signatures'
    AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );
