-- Per-engagement contracts for freelancers/subcontractors (individual or
-- company), distinct from the fixed onboarding NDA + service agreement in
-- freelancer_documents. Admin-created; signed in-portal or downloaded as PDF.
CREATE TABLE IF NOT EXISTS public.team_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES public.freelancer_profiles(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('individual', 'company')),

  -- Individual fields (entity_type = 'individual')
  individual_full_name TEXT,
  individual_address TEXT,
  individual_nationality TEXT,
  individual_ni_number TEXT,

  -- Company fields (entity_type = 'company')
  company_name TEXT,
  company_registered_office TEXT,
  company_jurisdiction TEXT,
  company_registration_number TEXT,
  company_vat_number TEXT,
  company_director_name TEXT,
  company_director_title TEXT,

  -- Shared scope fields
  subject_line TEXT NOT NULL,
  scope_description TEXT NOT NULL,
  project_reference TEXT,
  delivery_window_start DATE,
  delivery_window_end DATE,
  round_1_deadline DATE,
  round_2_deadline DATE,

  -- Fee fields
  fee_amount NUMERIC(10,2) NOT NULL,
  fee_currency TEXT NOT NULL DEFAULT 'EUR',
  fee_scope_description TEXT,
  payment_milestone_1_pct INTEGER DEFAULT 10,
  payment_milestone_2_pct INTEGER DEFAULT 40,
  payment_milestone_3_pct INTEGER DEFAULT 50,

  -- Status + storage
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'declined', 'cancelled')),
  storage_path TEXT,
  sent_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  signed_by_user_id UUID REFERENCES auth.users(id),

  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_contracts_account_id ON public.team_contracts(account_id);
CREATE INDEX IF NOT EXISTS idx_team_contracts_profile_id ON public.team_contracts(profile_id);
CREATE INDEX IF NOT EXISTS idx_team_contracts_status     ON public.team_contracts(status);

ALTER TABLE public.team_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all team contracts" ON public.team_contracts
  FOR ALL TO public
  USING (is_admin())
  WITH CHECK (is_admin());

-- Recipient can see their contract before signing (via their freelancer
-- profile) and after (via signed_by_user_id). Keyed off freelancer_profiles,
-- not account_members, because team membership lives in the freelancer model.
CREATE POLICY "Team members can view their own contracts" ON public.team_contracts
  FOR SELECT TO public
  USING (
    signed_by_user_id = auth.uid()
    OR profile_id IN (SELECT id FROM public.freelancer_profiles WHERE user_id = auth.uid())
  );
