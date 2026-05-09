UPDATE public.agreement_terms_versions SET is_current = false WHERE is_current = true;
INSERT INTO public.agreement_terms_versions (version_code, title, content, is_current)
VALUES ('SSS-TOSA-v1.1-PARTNER', 'Terms of Use and Services Agreement', 'See client/edge function source for full content (rendered server-side).', true)
ON CONFLICT (version_code) DO UPDATE SET is_current = true;