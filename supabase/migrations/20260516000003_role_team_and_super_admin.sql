-- Migration: 20260516000003_role_team_and_super_admin.sql
-- 1. Add 'team' to the app_role enum so team members get a real semantic role
--    instead of being labelled 'client' with account_type='team' as a discriminator.
-- 2. Add profiles.is_super_admin for Fred-only feature gates (Kieran is admin
--    but not super-admin).
-- 3. Migrate the existing one team user's user_roles row from 'client' to 'team',
--    guarded so dual-account users (client + team) keep their client role.
-- 4. Add an is_super_admin() helper.
--
-- Idempotent: ADD VALUE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE OR
-- REPLACE FUNCTION. The UPDATE is no-op on re-run since the WHERE matches only
-- pre-migration shape.

-- 1. Enum value
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'team';

-- 2. profiles.is_super_admin
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

-- 3. Fred is super admin (idempotent — re-run leaves the row at true)
UPDATE profiles
SET is_super_admin = true
WHERE user_id = (
  SELECT id FROM auth.users WHERE email = 'fred@silvershadowstudio.com' LIMIT 1
);

-- 4. Migrate team users: role='client' → role='team' where membership is
--    exclusively on a team account.
UPDATE user_roles ur
SET role = 'team'::app_role
WHERE ur.role = 'client'
  AND EXISTS (
    SELECT 1
    FROM account_members am
    JOIN accounts a ON a.id = am.account_id
    WHERE am.user_id = ur.user_id
      AND a.account_type = 'team'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM account_members am
    JOIN accounts a ON a.id = am.account_id
    WHERE am.user_id = ur.user_id
      AND a.account_type IN ('partnership','project')
  );

-- 5. is_super_admin() helper
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT COALESCE(
    (SELECT p.is_super_admin
       FROM profiles p
       WHERE p.user_id = auth.uid()
       LIMIT 1),
    false
  )
$$;
