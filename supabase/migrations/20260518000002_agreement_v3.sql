-- Client Agreement v3.0 — adds schedule-type discrimination and forensic
-- metadata fields to the existing `agreements` table.
--
-- Notes (codebase ↔ brief reconciliation, recorded here for traceability):
--   * `agreement_version` already exists with default 'SSS-TOSA-v1.0'. The
--     brief's `ADD COLUMN IF NOT EXISTS ... DEFAULT 'SSS-CA-PROJECT-v3.0'`
--     is a no-op for an existing column. Application code passes the
--     version explicitly going forward — DB default is unused in v3.
--   * The brief refers to `signed_by_name` / `signed_by_position`. The
--     existing columns are `signatory_name` / `signatory_position` (same
--     semantics, older naming). No new columns needed.
--   * `signatures_audit_log` requires no schema change — its existing
--     `document_type` + `version_code` columns are free-text and accommodate
--     the v3 values directly.

ALTER TABLE agreements
  ADD COLUMN IF NOT EXISTS agreement_version TEXT NOT NULL DEFAULT 'SSS-CA-PROJECT-v3.0',
  ADD COLUMN IF NOT EXISTS schedule_type TEXT CHECK (schedule_type IN ('project', 'partnership')),
  ADD COLUMN IF NOT EXISTS scrolled_to_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS time_on_page_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS pdf_downloaded_before_signing BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_agreements_version ON agreements(agreement_version);
CREATE INDEX IF NOT EXISTS idx_agreements_schedule_type ON agreements(schedule_type);
