-- Allow admins to insert accounts directly (currently no INSERT policy exists).
-- This is needed so admins can create client accounts on behalf of customers.
CREATE POLICY "Admins can insert accounts"
ON public.accounts
FOR INSERT
TO authenticated
WITH CHECK (is_admin());

-- Allow admins to insert account_members directly (the existing ALL policy
-- already covers this via is_admin(), but we make it explicit and ensure
-- admins can also insert without being the owner).
-- The existing "Admins manage all members" ALL policy already covers INSERT,
-- so no change needed there.

-- Allow admins to insert account invitations on behalf of any account
-- (current INSERT policy requires invited_by = auth.uid() AND is_account_owner,
-- which blocks admins from inviting into accounts they don't own).
CREATE POLICY "Admins can insert any invitation"
ON public.account_invitations
FOR INSERT
TO authenticated
WITH CHECK (is_admin());

-- Allow admins to revoke any invitation
CREATE POLICY "Admins can update any invitation"
ON public.account_invitations
FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());