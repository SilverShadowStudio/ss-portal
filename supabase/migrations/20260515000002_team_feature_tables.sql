-- Team feature: account invitations, freelancer profiles, documents, and agreements.
-- These tables were created directly on the live DB without migration files; this recovers them.

-- ─── account_invitations ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_invitations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  email          text NOT NULL,
  role           app_role NOT NULL DEFAULT 'user',
  token          text NOT NULL UNIQUE,
  invited_by     uuid NOT NULL,
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at    timestamptz,
  accepted_user_id uuid,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_invitations_account_id ON public.account_invitations(account_id);
CREATE INDEX IF NOT EXISTS idx_account_invitations_email     ON public.account_invitations(lower(email));

ALTER TABLE public.account_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner views invitations"
  ON public.account_invitations FOR SELECT TO authenticated
  USING (is_account_owner(account_id));

CREATE POLICY "Owner creates invitations"
  ON public.account_invitations FOR INSERT TO authenticated
  WITH CHECK (is_account_owner(account_id) AND invited_by = auth.uid());

CREATE POLICY "Owner revokes invitations"
  ON public.account_invitations FOR UPDATE TO authenticated
  USING (is_account_owner(account_id))
  WITH CHECK (is_account_owner(account_id));

CREATE POLICY "Admins view all invitations"
  ON public.account_invitations FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "Admins can insert any invitation"
  ON public.account_invitations FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update any invitation"
  ON public.account_invitations FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ─── freelancer_profiles ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.freelancer_profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name     text NOT NULL,
  last_name      text NOT NULL,
  email          text NOT NULL,
  role           text,
  day_rate       numeric,
  rate_currency  text DEFAULT 'GBP',
  rate_period    text DEFAULT 'day',
  bank_name      text,
  account_number text,
  sort_code      text,
  account_holder text,
  address        text,
  flat_number    text,
  house_number   text,
  street_name    text,
  city           text,
  postcode       text,
  country        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.freelancer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fp_own_all"
  ON public.freelancer_profiles FOR ALL TO public
  USING (auth.uid() = user_id);

CREATE POLICY "fp_admin_read"
  ON public.freelancer_profiles FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
  ));


-- ─── freelancer_documents ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.freelancer_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid REFERENCES public.accounts(id),
  profile_id    uuid REFERENCES public.freelancer_profiles(id),
  document_type text NOT NULL,
  signed_at     timestamptz,
  signed_by_name text,
  pdf_url       text,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.freelancer_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fd_own_select"
  ON public.freelancer_documents FOR SELECT TO public
  USING (profile_id IN (
    SELECT id FROM public.freelancer_profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "fd_admin_read"
  ON public.freelancer_documents FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
  ));


-- ─── freelancer_agreements ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.freelancer_agreements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signatory_name text,
  storage_path   text NOT NULL,
  file_name      text NOT NULL,
  file_size      bigint,
  signed_at      timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.freelancer_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fa_own_select"
  ON public.freelancer_agreements FOR SELECT TO public
  USING (auth.uid() = user_id);

CREATE POLICY "fa_admin_read"
  ON public.freelancer_agreements FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
  ));
