-- =========================================================================
-- 1. CORE TABLES
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  country text,
  registration_number text,
  street_name text,
  building_number text,
  city text,
  postcode text,
  owner_user_id uuid NOT NULL,
  agreement_acknowledged_version text,
  agreement_acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accounts_owner_user_id ON public.accounts(owner_user_id);

CREATE TABLE IF NOT EXISTS public.account_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.app_role NOT NULL DEFAULT 'user',
  invited_by uuid,
  invited_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  last_login_ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id),
  UNIQUE (account_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS account_members_one_owner_per_account
  ON public.account_members(account_id) WHERE role = 'owner';
CREATE INDEX IF NOT EXISTS idx_account_members_account_id ON public.account_members(account_id);

CREATE TABLE IF NOT EXISTS public.account_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'user',
  token text NOT NULL UNIQUE,
  invited_by uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_user_id uuid,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_invitations_account_id ON public.account_invitations(account_id);
CREATE INDEX IF NOT EXISTS idx_account_invitations_email ON public.account_invitations(lower(email));

CREATE TABLE IF NOT EXISTS public.account_user_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  actor_user_id uuid,
  target_user_id uuid,
  target_email text,
  event_type text NOT NULL,
  ip_address text,
  user_agent text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_user_audit_account_id ON public.account_user_audit(account_id);

DROP TRIGGER IF EXISTS trg_accounts_updated_at ON public.accounts;
CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_account_members_updated_at ON public.account_members;
CREATE TRIGGER trg_account_members_updated_at
  BEFORE UPDATE ON public.account_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- 2. ATTACH account_id TO EXISTING DOMAIN TABLES
-- =========================================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_id uuid;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS account_id uuid;
-- agreements.account_id already exists; ensure FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_account_id_fkey'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_account_id_fkey'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agreements_account_id_fkey'
  ) THEN
    ALTER TABLE public.agreements
      ADD CONSTRAINT agreements_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_profiles_account_id   ON public.profiles(account_id);
CREATE INDEX IF NOT EXISTS idx_projects_account_id   ON public.projects(account_id);
CREATE INDEX IF NOT EXISTS idx_agreements_account_id ON public.agreements(account_id);

-- =========================================================================
-- 3. BACKFILL — each existing user becomes Owner of a new company account
-- =========================================================================
DO $backfill$
DECLARE
  r record;
  new_account_id uuid;
  src_company text;
  ack_version text;
  ack_at timestamptz;
BEGIN
  FOR r IN
    SELECT p.user_id, p.company AS profile_company
    FROM public.profiles p
    LEFT JOIN public.account_members am ON am.user_id = p.user_id
    WHERE am.user_id IS NULL
  LOOP
    SELECT a.company_name, a.agreement_version, a.accepted_at
      INTO src_company, ack_version, ack_at
      FROM public.agreements a
     WHERE a.user_id = r.user_id
     ORDER BY a.accepted_at DESC
     LIMIT 1;

    IF src_company IS NULL THEN
      src_company := COALESCE(NULLIF(r.profile_company, ''), 'Account');
    END IF;

    INSERT INTO public.accounts (
      company_name, owner_user_id,
      agreement_acknowledged_version, agreement_acknowledged_at
    ) VALUES (
      src_company, r.user_id, ack_version, ack_at
    )
    RETURNING id INTO new_account_id;

    INSERT INTO public.account_members (account_id, user_id, role, joined_at)
    VALUES (new_account_id, r.user_id, 'owner', now());

    UPDATE public.profiles   SET account_id = new_account_id WHERE user_id = r.user_id;
    UPDATE public.projects   SET account_id = new_account_id WHERE user_id = r.user_id AND account_id IS NULL;
    UPDATE public.agreements SET account_id = new_account_id WHERE user_id = r.user_id AND account_id IS NULL;
  END LOOP;
END
$backfill$;

-- =========================================================================
-- 4. SECURITY-DEFINER HELPERS
-- =========================================================================
CREATE OR REPLACE FUNCTION public.current_account_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT account_id FROM public.account_members WHERE user_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_account_member(_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE user_id = auth.uid() AND account_id = _account_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_account_owner(_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE user_id = auth.uid() AND account_id = _account_id AND role = 'owner'
  )
$$;

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(_token text)
RETURNS TABLE (
  id uuid, account_id uuid, company_name text, email text,
  role public.app_role, expires_at timestamptz,
  accepted_at timestamptz, revoked_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.account_id, a.company_name, i.email, i.role,
         i.expires_at, i.accepted_at, i.revoked_at
  FROM public.account_invitations i
  JOIN public.accounts a ON a.id = i.account_id
  WHERE i.token = _token
$$;

GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_account_id()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_account_owner(uuid)         TO authenticated;

-- =========================================================================
-- 5. RLS ON NEW TABLES
-- =========================================================================
ALTER TABLE public.accounts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_user_audit  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view their account"
  ON public.accounts FOR SELECT TO authenticated
  USING (public.is_account_member(id));
CREATE POLICY "Owner updates account"
  ON public.accounts FOR UPDATE TO authenticated
  USING (public.is_account_owner(id))
  WITH CHECK (public.is_account_owner(id));
CREATE POLICY "Admins view all accounts"
  ON public.accounts FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "Admins update all accounts"
  ON public.accounts FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "Members view their team"
  ON public.account_members FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY "Owner inserts members"
  ON public.account_members FOR INSERT TO authenticated
  WITH CHECK (public.is_account_owner(account_id));
CREATE POLICY "Owner updates members"
  ON public.account_members FOR UPDATE TO authenticated
  USING (public.is_account_owner(account_id))
  WITH CHECK (public.is_account_owner(account_id));
CREATE POLICY "Owner removes members"
  ON public.account_members FOR DELETE TO authenticated
  USING (public.is_account_owner(account_id) AND user_id <> auth.uid());
CREATE POLICY "Admins manage all members"
  ON public.account_members FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Owner views invitations"
  ON public.account_invitations FOR SELECT TO authenticated
  USING (public.is_account_owner(account_id));
CREATE POLICY "Owner creates invitations"
  ON public.account_invitations FOR INSERT TO authenticated
  WITH CHECK (public.is_account_owner(account_id) AND invited_by = auth.uid());
CREATE POLICY "Owner revokes invitations"
  ON public.account_invitations FOR UPDATE TO authenticated
  USING (public.is_account_owner(account_id))
  WITH CHECK (public.is_account_owner(account_id));
CREATE POLICY "Admins view all invitations"
  ON public.account_invitations FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Owner views audit"
  ON public.account_user_audit FOR SELECT TO authenticated
  USING (public.is_account_owner(account_id));
CREATE POLICY "Members view own audit entries"
  ON public.account_user_audit FOR SELECT TO authenticated
  USING (target_user_id = auth.uid() OR actor_user_id = auth.uid());
CREATE POLICY "Admins view all audit"
  ON public.account_user_audit FOR SELECT TO authenticated
  USING (public.is_admin());

-- =========================================================================
-- 6. REWRITE EXISTING POLICIES TO SHARE DATA WITHIN AN ACCOUNT
-- =========================================================================

-- projects
DROP POLICY IF EXISTS "Users can insert their own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update their own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can view their own projects"   ON public.projects;
CREATE POLICY "Members can view account projects"
  ON public.projects FOR SELECT TO authenticated
  USING (account_id IS NOT NULL AND public.is_account_member(account_id));
CREATE POLICY "Members can insert account projects"
  ON public.projects FOR INSERT TO authenticated
  WITH CHECK (account_id IS NOT NULL AND public.is_account_member(account_id));
CREATE POLICY "Members can update account projects"
  ON public.projects FOR UPDATE TO authenticated
  USING (account_id IS NOT NULL AND public.is_account_member(account_id));

-- scenes
DROP POLICY IF EXISTS "Users can insert scenes to their projects" ON public.scenes;
DROP POLICY IF EXISTS "Users can update scenes of their projects"  ON public.scenes;
DROP POLICY IF EXISTS "Users can view scenes of their projects"    ON public.scenes;
CREATE POLICY "Members can view account scenes"
  ON public.scenes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = scenes.project_id AND public.is_account_member(p.account_id)));
CREATE POLICY "Members can insert account scenes"
  ON public.scenes FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = scenes.project_id AND public.is_account_member(p.account_id)));
CREATE POLICY "Members can update account scenes"
  ON public.scenes FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = scenes.project_id AND public.is_account_member(p.account_id)));

-- scene_rounds
DROP POLICY IF EXISTS "Users can insert rounds to their scenes" ON public.scene_rounds;
DROP POLICY IF EXISTS "Users can update rounds of their scenes" ON public.scene_rounds;
DROP POLICY IF EXISTS "Users can view rounds of their scenes"   ON public.scene_rounds;
CREATE POLICY "Members can view account rounds"
  ON public.scene_rounds FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.scenes s
    JOIN public.projects p ON p.id = s.project_id
    WHERE s.id = scene_rounds.scene_id AND public.is_account_member(p.account_id)
  ));
CREATE POLICY "Members can insert account rounds"
  ON public.scene_rounds FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.scenes s
    JOIN public.projects p ON p.id = s.project_id
    WHERE s.id = scene_rounds.scene_id AND public.is_account_member(p.account_id)
  ));
CREATE POLICY "Members can update account rounds"
  ON public.scene_rounds FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.scenes s
    JOIN public.projects p ON p.id = s.project_id
    WHERE s.id = scene_rounds.scene_id AND public.is_account_member(p.account_id)
  ));

-- round_assets
DROP POLICY IF EXISTS "Users can view assets of their scenes" ON public.round_assets;
CREATE POLICY "Members can view account assets"
  ON public.round_assets FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.scene_rounds sr
    JOIN public.scenes s ON s.id = sr.scene_id
    JOIN public.projects p ON p.id = s.project_id
    WHERE sr.id = round_assets.scene_round_id AND public.is_account_member(p.account_id)
  ));

-- asset_comments
DROP POLICY IF EXISTS "Users can insert comments on their assets" ON public.asset_comments;
DROP POLICY IF EXISTS "Users can view comments on their assets"   ON public.asset_comments;
CREATE POLICY "Members can view account asset comments"
  ON public.asset_comments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.round_assets ra
    JOIN public.scene_rounds sr ON sr.id = ra.scene_round_id
    JOIN public.scenes s ON s.id = sr.scene_id
    JOIN public.projects p ON p.id = s.project_id
    WHERE ra.id = asset_comments.asset_id AND public.is_account_member(p.account_id)
  ));
CREATE POLICY "Members can insert account asset comments"
  ON public.asset_comments FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND EXISTS (
      SELECT 1 FROM public.round_assets ra
      JOIN public.scene_rounds sr ON sr.id = ra.scene_round_id
      JOIN public.scenes s ON s.id = sr.scene_id
      JOIN public.projects p ON p.id = s.project_id
      WHERE ra.id = asset_comments.asset_id AND public.is_account_member(p.account_id)
    )
  );

-- asset_pins
DROP POLICY IF EXISTS "Clients can create pins on their assets" ON public.asset_pins;
DROP POLICY IF EXISTS "Clients can resolve their own pins"      ON public.asset_pins;
DROP POLICY IF EXISTS "Clients can delete their own pins"       ON public.asset_pins;
DROP POLICY IF EXISTS "Clients can view pins on their assets"   ON public.asset_pins;
CREATE POLICY "Members can view account pins"
  ON public.asset_pins FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.round_assets ra
    JOIN public.scene_rounds sr ON sr.id = ra.scene_round_id
    JOIN public.scenes s ON s.id = sr.scene_id
    JOIN public.projects p ON p.id = s.project_id
    WHERE ra.id = asset_pins.asset_id AND public.is_account_member(p.account_id)
  ));
CREATE POLICY "Members can create account pins"
  ON public.asset_pins FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by AND EXISTS (
      SELECT 1 FROM public.round_assets ra
      JOIN public.scene_rounds sr ON sr.id = ra.scene_round_id
      JOIN public.scenes s ON s.id = sr.scene_id
      JOIN public.projects p ON p.id = s.project_id
      WHERE ra.id = asset_pins.asset_id AND public.is_account_member(p.account_id)
    )
  );
CREATE POLICY "Members can update account pins"
  ON public.asset_pins FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.round_assets ra
    JOIN public.scene_rounds sr ON sr.id = ra.scene_round_id
    JOIN public.scenes s ON s.id = sr.scene_id
    JOIN public.projects p ON p.id = s.project_id
    WHERE ra.id = asset_pins.asset_id AND public.is_account_member(p.account_id)
  ));
CREATE POLICY "Members can delete account pins"
  ON public.asset_pins FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.round_assets ra
    JOIN public.scene_rounds sr ON sr.id = ra.scene_round_id
    JOIN public.scenes s ON s.id = sr.scene_id
    JOIN public.projects p ON p.id = s.project_id
    WHERE ra.id = asset_pins.asset_id AND public.is_account_member(p.account_id)
  ));

-- asset_pin_messages
DROP POLICY IF EXISTS "Clients can post messages on accessible pins"   ON public.asset_pin_messages;
DROP POLICY IF EXISTS "Clients can view messages on accessible pins"   ON public.asset_pin_messages;
DROP POLICY IF EXISTS "Clients can delete messages on pins they own"   ON public.asset_pin_messages;
CREATE POLICY "Members can view account pin messages"
  ON public.asset_pin_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.asset_pins ap
    JOIN public.round_assets ra ON ra.id = ap.asset_id
    JOIN public.scene_rounds sr ON sr.id = ra.scene_round_id
    JOIN public.scenes s ON s.id = sr.scene_id
    JOIN public.projects p ON p.id = s.project_id
    WHERE ap.id = asset_pin_messages.pin_id AND public.is_account_member(p.account_id)
  ));
CREATE POLICY "Members can post account pin messages"
  ON public.asset_pin_messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND EXISTS (
      SELECT 1 FROM public.asset_pins ap
      JOIN public.round_assets ra ON ra.id = ap.asset_id
      JOIN public.scene_rounds sr ON sr.id = ra.scene_round_id
      JOIN public.scenes s ON s.id = sr.scene_id
      JOIN public.projects p ON p.id = s.project_id
      WHERE ap.id = asset_pin_messages.pin_id AND public.is_account_member(p.account_id)
    )
  );
CREATE POLICY "Members can delete own pin messages"
  ON public.asset_pin_messages FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- asset_drawings
DROP POLICY IF EXISTS "Clients can create drawings on their assets" ON public.asset_drawings;
DROP POLICY IF EXISTS "Clients can view drawings on their assets"   ON public.asset_drawings;
DROP POLICY IF EXISTS "Clients can delete their own drawings"       ON public.asset_drawings;
CREATE POLICY "Members can view account drawings"
  ON public.asset_drawings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.round_assets ra
    JOIN public.scene_rounds sr ON sr.id = ra.scene_round_id
    JOIN public.scenes s ON s.id = sr.scene_id
    JOIN public.projects p ON p.id = s.project_id
    WHERE ra.id = asset_drawings.asset_id AND public.is_account_member(p.account_id)
  ));
CREATE POLICY "Members can create account drawings"
  ON public.asset_drawings FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by AND EXISTS (
      SELECT 1 FROM public.round_assets ra
      JOIN public.scene_rounds sr ON sr.id = ra.scene_round_id
      JOIN public.scenes s ON s.id = sr.scene_id
      JOIN public.projects p ON p.id = s.project_id
      WHERE ra.id = asset_drawings.asset_id AND public.is_account_member(p.account_id)
    )
  );
CREATE POLICY "Members can delete own drawings"
  ON public.asset_drawings FOR DELETE TO authenticated
  USING (auth.uid() = created_by);

-- asset_approvals
DROP POLICY IF EXISTS "Users can insert approvals on their assets" ON public.asset_approvals;
DROP POLICY IF EXISTS "Users can view approvals on their assets"   ON public.asset_approvals;
DROP POLICY IF EXISTS "Users can update their own approvals"       ON public.asset_approvals;
CREATE POLICY "Members can view account approvals"
  ON public.asset_approvals FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.round_assets ra
    JOIN public.scene_rounds sr ON sr.id = ra.scene_round_id
    JOIN public.scenes s ON s.id = sr.scene_id
    JOIN public.projects p ON p.id = s.project_id
    WHERE ra.id = asset_approvals.asset_id AND public.is_account_member(p.account_id)
  ));
CREATE POLICY "Members can insert account approvals"
  ON public.asset_approvals FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND EXISTS (
      SELECT 1 FROM public.round_assets ra
      JOIN public.scene_rounds sr ON sr.id = ra.scene_round_id
      JOIN public.scenes s ON s.id = sr.scene_id
      JOIN public.projects p ON p.id = s.project_id
      WHERE ra.id = asset_approvals.asset_id AND public.is_account_member(p.account_id)
    )
  );
CREATE POLICY "Members can update own approvals"
  ON public.asset_approvals FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- scene_messages
DROP POLICY IF EXISTS "Users can insert messages to their scenes" ON public.scene_messages;
DROP POLICY IF EXISTS "Users can view messages of their scenes"   ON public.scene_messages;
CREATE POLICY "Members can view account scene messages"
  ON public.scene_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.scenes s
    JOIN public.projects p ON p.id = s.project_id
    WHERE s.id = scene_messages.scene_id AND public.is_account_member(p.account_id)
  ));
CREATE POLICY "Members can insert account scene messages"
  ON public.scene_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.scenes s
    JOIN public.projects p ON p.id = s.project_id
    WHERE s.id = scene_messages.scene_id AND public.is_account_member(p.account_id)
  ));

-- round_uploads
DROP POLICY IF EXISTS "Users can insert their own round uploads" ON public.round_uploads;
DROP POLICY IF EXISTS "Users can view their own round uploads"   ON public.round_uploads;
DROP POLICY IF EXISTS "Users can delete their own round uploads" ON public.round_uploads;
CREATE POLICY "Members can view account round uploads"
  ON public.round_uploads FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.scenes s
    JOIN public.projects p ON p.id = s.project_id
    WHERE s.id = round_uploads.scene_id AND public.is_account_member(p.account_id)
  ));
CREATE POLICY "Members can insert account round uploads"
  ON public.round_uploads FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND EXISTS (
      SELECT 1 FROM public.scenes s
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.id = round_uploads.scene_id AND public.is_account_member(p.account_id)
    )
  );
CREATE POLICY "Members can delete own round uploads"
  ON public.round_uploads FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- invoices
DROP POLICY IF EXISTS "Users can update their own invoices" ON public.invoices;
DROP POLICY IF EXISTS "Users can view their own invoices"   ON public.invoices;
CREATE POLICY "Members can view account invoices"
  ON public.invoices FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = invoices.project_id AND public.is_account_member(p.account_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.account_members am
      WHERE am.user_id = invoices.user_id AND public.is_account_member(am.account_id)
    )
  );
CREATE POLICY "Owner can update account invoices"
  ON public.invoices FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = invoices.project_id AND public.is_account_owner(p.account_id)
  ));

-- quotations
DROP POLICY IF EXISTS "Users can update their own quotations" ON public.quotations;
DROP POLICY IF EXISTS "Users can view their own quotations"   ON public.quotations;
CREATE POLICY "Members can view account quotations"
  ON public.quotations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = quotations.project_id AND public.is_account_member(p.account_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.account_members am
      WHERE am.user_id = quotations.user_id AND public.is_account_member(am.account_id)
    )
  );
CREATE POLICY "Owner can update account quotations"
  ON public.quotations FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = quotations.project_id AND public.is_account_owner(p.account_id)
  ));

-- amount_adjustments
DROP POLICY IF EXISTS "Users can update their own amount adjustments" ON public.amount_adjustments;
DROP POLICY IF EXISTS "Users can view their own amount adjustments"   ON public.amount_adjustments;
CREATE POLICY "Members can view account amount adjustments"
  ON public.amount_adjustments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.account_members am
    WHERE am.user_id = amount_adjustments.user_id AND public.is_account_member(am.account_id)
  ));
CREATE POLICY "Owner updates account amount adjustments"
  ON public.amount_adjustments FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.account_members am
    WHERE am.user_id = amount_adjustments.user_id AND public.is_account_owner(am.account_id)
  ));

-- agreements
DROP POLICY IF EXISTS "Users can view their own agreements"  ON public.agreements;
CREATE POLICY "Members can view account agreements"
  ON public.agreements FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR (account_id IS NOT NULL AND public.is_account_member(account_id))
  );

-- agreement_audit_log
DROP POLICY IF EXISTS "Users can view own audit entries" ON public.agreement_audit_log;
CREATE POLICY "Owner can view account agreement audit"
  ON public.agreement_audit_log FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR (account_id IS NOT NULL AND public.is_account_owner(account_id))
  );

-- =========================================================================
-- 7. AGREEMENT VERSION 1.2
-- =========================================================================
UPDATE public.agreement_terms_versions SET is_current = false WHERE is_current = true;

INSERT INTO public.agreement_terms_versions (version_code, title, content, is_current, effective_at)
VALUES (
  'SSS-TOSA-v1.2',
  'SILVERSHADOW STUDIO LIMITED — Terms of Use and Services Agreement',
  'Stored in code (src/lib/agreementTerms.ts and supabase/functions/accept-agreement/agreementContent.ts). This row exists for version validation, audit and future migration only.',
  true,
  now()
)
ON CONFLICT DO NOTHING;
