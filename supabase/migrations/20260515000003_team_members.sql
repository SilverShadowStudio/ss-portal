-- Add 'team' account type and create freelancer tables.

-- Extend account_type check constraint to include 'team'.
DO $$
BEGIN
  BEGIN
    ALTER TABLE accounts DROP CONSTRAINT accounts_account_type_check;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
END $$;

ALTER TABLE accounts ADD CONSTRAINT accounts_account_type_check
  CHECK (account_type IN ('partnership', 'project', 'team'));

-- Freelancer profiles: one row per team user, upserted during onboarding.
CREATE TABLE IF NOT EXISTS freelancer_profiles (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name     TEXT         NOT NULL,
  last_name      TEXT         NOT NULL,
  email          TEXT         NOT NULL,
  role           TEXT,
  day_rate       NUMERIC(10,2),
  bank_name      TEXT,
  account_number TEXT,
  sort_code      TEXT,
  account_holder TEXT,
  address        TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Freelancer agreements: immutable signed PDF records.
CREATE TABLE IF NOT EXISTS freelancer_agreements (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signatory_name TEXT,
  storage_path   TEXT         NOT NULL,
  file_name      TEXT         NOT NULL,
  file_size      BIGINT,
  signed_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- RLS on tables.
ALTER TABLE freelancer_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE freelancer_agreements ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own profile.
CREATE POLICY "fp_own_all" ON freelancer_profiles
  FOR ALL USING (auth.uid() = user_id);

-- Admins can read all profiles.
CREATE POLICY "fp_admin_read" ON freelancer_profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Users can read their own agreements.
CREATE POLICY "fa_own_select" ON freelancer_agreements
  FOR SELECT USING (auth.uid() = user_id);

-- Admins can read all agreements.
CREATE POLICY "fa_admin_read" ON freelancer_agreements
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Storage bucket for freelancer agreement PDFs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('freelancer-agreements', 'freelancer-agreements', false)
ON CONFLICT DO NOTHING;

-- Users can manage their own files in the bucket.
CREATE POLICY "fa_storage_own" ON storage.objects
  FOR ALL USING (
    bucket_id = 'freelancer-agreements' AND
    auth.uid()::text = split_part(name, '/', 1)
  );

-- Admins can read any file in the bucket (for signed URL generation).
CREATE POLICY "fa_storage_admin" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'freelancer-agreements' AND
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );
