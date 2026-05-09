-- 1. Extend agreements table with legal metadata
ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS agreement_version text NOT NULL DEFAULT 'SSS-TOSA-v1.0',
  ADD COLUMN IF NOT EXISTS agreement_uid text,
  ADD COLUMN IF NOT EXISTS accepted_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS accepted_by_name text,
  ADD COLUMN IF NOT EXISTS accepted_by_email text,
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS checkbox_text text,
  ADD COLUMN IF NOT EXISTS account_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS agreements_agreement_uid_key
  ON public.agreements(agreement_uid)
  WHERE agreement_uid IS NOT NULL;

-- 2. Terms versions table
CREATE TABLE IF NOT EXISTS public.agreement_terms_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_code text NOT NULL UNIQUE,
  title text NOT NULL,
  content text NOT NULL,
  effective_at timestamp with time zone NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.agreement_terms_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view terms versions" ON public.agreement_terms_versions;
CREATE POLICY "Authenticated users can view terms versions"
  ON public.agreement_terms_versions
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Anonymous users can view current terms" ON public.agreement_terms_versions;
CREATE POLICY "Anonymous users can view current terms"
  ON public.agreement_terms_versions
  FOR SELECT
  TO anon
  USING (is_current = true);

DROP POLICY IF EXISTS "Admins can insert terms versions" ON public.agreement_terms_versions;
CREATE POLICY "Admins can insert terms versions"
  ON public.agreement_terms_versions
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins can update terms versions" ON public.agreement_terms_versions;
CREATE POLICY "Admins can update terms versions"
  ON public.agreement_terms_versions
  FOR UPDATE
  TO authenticated
  USING (is_admin());

-- 3. Immutable audit log
CREATE TABLE IF NOT EXISTS public.agreement_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid,
  agreement_id uuid,
  agreement_uid text,
  agreement_version text NOT NULL,
  checkbox_text text NOT NULL,
  accepted_at timestamp with time zone NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  storage_path text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.agreement_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit log
DROP POLICY IF EXISTS "Admins can view audit log" ON public.agreement_audit_log;
CREATE POLICY "Admins can view audit log"
  ON public.agreement_audit_log
  FOR SELECT
  TO authenticated
  USING (is_admin());

-- Users may view their own audit entries
DROP POLICY IF EXISTS "Users can view own audit entries" ON public.agreement_audit_log;
CREATE POLICY "Users can view own audit entries"
  ON public.agreement_audit_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No one can update or delete via API. Inserts will be done server-side via service role (bypasses RLS).

-- 4. Seed the current Terms version
INSERT INTO public.agreement_terms_versions (version_code, title, content, is_current)
VALUES (
  'SSS-TOSA-v1.0',
  'SILVERSHADOW STUDIO LIMITED — Terms of Use and Services Agreement',
  'See bundled PDF template — full text stored in application source.',
  true
)
ON CONFLICT (version_code) DO NOTHING;