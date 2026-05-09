INSERT INTO public.agreement_terms_versions (version_code, title, content, is_current)
VALUES ('SSS-TOSA-v1.1', 'Terms of Use & Services Agreement', 'See app/edge function for rendered content.', true)
ON CONFLICT (version_code) DO UPDATE SET is_current = true;