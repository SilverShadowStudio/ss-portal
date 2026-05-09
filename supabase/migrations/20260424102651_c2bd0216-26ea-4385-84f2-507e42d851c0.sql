-- 1. Add immutable PDF integrity hash to agreements + audit log
ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS pdf_sha256 text;

ALTER TABLE public.agreement_audit_log
  ADD COLUMN IF NOT EXISTS pdf_sha256 text;

-- 2. Register the new agreement version SSS-TOSA-v1.1 and make it current
UPDATE public.agreement_terms_versions
   SET is_current = false
 WHERE is_current = true;

INSERT INTO public.agreement_terms_versions (version_code, title, content, is_current, effective_at)
VALUES (
  'SSS-TOSA-v1.1',
  'SILVERSHADOW STUDIO LIMITED — Terms of Use and Services Agreement',
  'Stored in code (src/lib/agreementTerms.ts and supabase/functions/accept-agreement/agreementContent.ts). This row exists for version validation, audit and future migration only.',
  true,
  now()
)
ON CONFLICT DO NOTHING;
