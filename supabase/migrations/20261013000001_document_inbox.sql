-- Document inbox — one row per document dropped on the admin dashboard.
-- The parse-document function (?action=inbox) reads the file, classifies it,
-- names it per the filing strategy in parse-document/inbox.ts and files it to
-- Dropbox; this table is the audit trail and powers the "recently filed" list.
-- Additive only. Written by the function (service role); admins read it.

CREATE TABLE IF NOT EXISTS public.document_inbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  original_filename text NOT NULL,
  mime_type         text,
  size_bytes        bigint,
  sha256            text,
  status            text NOT NULL DEFAULT 'processing'
                    CHECK (status IN ('processing', 'filed', 'to_check', 'duplicate', 'failed')),
  doc_type          text,
  confidence        numeric,
  summary           text,
  reasoning         text,
  extracted         jsonb,
  dropbox_path      text,
  moved_from        text,
  error_text        text,
  model             text
);

CREATE INDEX IF NOT EXISTS document_inbox_created_at_idx ON public.document_inbox (created_at DESC);
CREATE INDEX IF NOT EXISTS document_inbox_sha256_idx ON public.document_inbox (sha256);

ALTER TABLE public.document_inbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_inbox_admin_select ON public.document_inbox;
CREATE POLICY document_inbox_admin_select ON public.document_inbox
  FOR SELECT USING (public.is_admin());
