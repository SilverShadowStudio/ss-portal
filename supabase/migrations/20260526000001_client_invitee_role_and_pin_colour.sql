-- Phase 1 multi-user — extends the existing account_invitations system.
-- Decision (confirmed by Fred): `owner` REMAINS the Client-Manager role; the UI
-- labels it "Manager". Only the restricted invitee role is new. No role backfill,
-- no is_account_owner change, no audit of existing 'owner' call-sites.
--
-- NOTE on transactions: a newly added enum value cannot be USED in the same
-- transaction it is added (Postgres). None of the statements below use
-- 'client_invitee' (the backfill only writes pin_colour), so this file is safe
-- to apply as a unit. Migration #2 (which references the value) is a separate
-- migration applied afterwards.

-- 1) New restricted role for invited client members.
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'client_invitee';

-- 2) Per-member pin/marker colour (derived onto pins + comments at render time).
ALTER TABLE public.account_members
  ADD COLUMN IF NOT EXISTS pin_colour TEXT;

-- 3) One-time seed: existing client Managers (owners on project/partnership
--    accounts, currently all single-Manager) get brand gold. Freelancer/team
--    accounts are left untouched (pin_colour stays NULL).
UPDATE public.account_members am
   SET pin_colour = '#B89A6A'
  FROM public.accounts a
 WHERE a.id = am.account_id
   AND am.role = 'owner'
   AND am.pin_colour IS NULL
   AND a.account_type IN ('partnership','project');
